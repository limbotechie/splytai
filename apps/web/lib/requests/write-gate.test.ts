import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_RECONCILIATION_AGE_MS, assertBillWritable, assertEconomicAmendmentAllowed,
  hasUnresolvedReport, parseReconciliationReceipt, readReconciliation, reconciliationRecordId,
  reconciliationSatisfied, recordReconciliation, requireWritableBill,
} from "./write-gate";
import { installCrypto } from "../private-workspace/test-support";
import type { BillManifest } from "../bills/types";
import type { RequestState } from "./types";
import { manifestFixture } from "./__tests__/fixtures";

const NOW = "2026-03-01T10:00:00.000Z";
const LATER = "2026-03-01T10:05:00.000Z";
const NOW_MS = Date.parse(NOW);

function bill(manifest: BillManifest, revision = 3): { revision: number; manifest: BillManifest } {
  return { revision, manifest };
}

function receipt(manifest: BillManifest, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { version: 1, billId: manifest.billId, revision: 3, reconciledAt: NOW, ...overrides };
}

type Guarded = Pick<RequestState, "reports" | "confirmations">;

const report = (id: string, reportedAt: string) => ({ id, envelope: {}, payload: {}, reportedAt }) as never;
const confirmation = (id: string, confirmedAt: string) => ({ id, envelope: {}, payload: {}, confirmedAt }) as never;

function guarded(reports: string[], confirmations: { id: string; at: string }[]): Guarded {
  return {
    reports: reports.map((at, index) => report(`${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`, at)),
    confirmations: confirmations.map(({ id, at }) => confirmation(id, at)),
  };
}

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("reconciliation receipt persistence", () => {
  it("stores one receipt per bill and reads it back verbatim", async () => {
    const manifest = await manifestFixture();
    const saved = await recordReconciliation(bill(manifest, 2), NOW);
    expect(saved).toEqual({ version: 1, billId: manifest.billId, revision: 2, reconciledAt: NOW });
    expect(await readReconciliation(manifest.billId)).toEqual(saved);
    expect(reconciliationRecordId(manifest.billId)).toBe(`sync:${manifest.billId}`);
  });

  it("keeps receipts scoped to their own bill", async () => {
    const first = await manifestFixture();
    const second = await manifestFixture("22222222-2222-4222-8222-222222222222");
    await recordReconciliation(bill(first), NOW);
    expect(await readReconciliation(second.billId)).toBeNull();
    expect(() => reconciliationRecordId("not-a-bill")).toThrow(/identifier is invalid/);
  });

  it("refreshes an existing receipt instead of conflicting with itself", async () => {
    const manifest = await manifestFixture();
    await recordReconciliation(bill(manifest), NOW);
    const refreshed = await recordReconciliation(bill(manifest), LATER);
    expect(refreshed.reconciledAt).toBe(LATER);
    expect(await readReconciliation(manifest.billId)).toEqual(refreshed);
  });

  it("rejects malformed time and revision values before writing anything", async () => {
    const manifest = await manifestFixture();
    expect(await readReconciliation(manifest.billId)).toBeNull();
    await expect(recordReconciliation(bill(manifest), "not a time")).rejects.toThrow(/reconciliation record is invalid/);
    await expect(recordReconciliation(bill(manifest), "2026-03-01")).rejects.toThrow(/reconciliation record is invalid/);
    await expect(recordReconciliation(bill(manifest, -1), NOW)).rejects.toThrow(/bill revision is invalid/);
    await expect(recordReconciliation(bill(manifest, 1.5), NOW)).rejects.toThrow(/bill revision is invalid/);
    expect(await readReconciliation(manifest.billId)).toBeNull();
  });

  it("parses only the exact receipt shape", async () => {
    const manifest = await manifestFixture();
    const valid = receipt(manifest);
    expect(parseReconciliationReceipt(valid)).toEqual(valid);
    expect(() => parseReconciliationReceipt({ ...valid, extra: true })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt({ ...valid, version: 2 })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt({ ...valid, billId: "not-a-bill" })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt({ ...valid, revision: -1 })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt({ ...valid, revision: 1.5 })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt({ ...valid, reconciledAt: "2026-03-01" })).toThrow(/reconciliation record is invalid/);
    expect(() => parseReconciliationReceipt(null)).toThrow(/reconciliation record is invalid/);
  });
});

describe("write-gate decision", () => {
  it("accepts a fresh receipt for this bill at or behind the local revision", async () => {
    const manifest = await manifestFixture();
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest), { now: NOW })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest, 5), receipt(manifest), { now: NOW })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest, { reconciledAt: LATER }), { now: LATER })).toBe(true);
  });

  it("rejects another bill, a newer receipt revision and malformed input", async () => {
    const manifest = await manifestFixture();
    const other = await manifestFixture("22222222-2222-4222-8222-222222222222");
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest, { billId: other.billId }), { now: NOW })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest, 2), receipt(manifest, { revision: 3 }), { now: NOW })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest), { ...receipt(manifest), extra: true }, { now: NOW })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest), null, { now: NOW })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest, -1), receipt(manifest), { now: NOW })).toBe(false);
  });

  it("rejects stale receipts and receipts suspiciously far in the future", async () => {
    const manifest = await manifestFixture();
    const fresh = receipt(manifest);
    expect(reconciliationSatisfied(bill(manifest), fresh, { now: NOW_MS + MAX_RECONCILIATION_AGE_MS })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest), fresh, { now: NOW_MS + MAX_RECONCILIATION_AGE_MS + 1 })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest), fresh, { now: NOW_MS - 5 * 60_000 })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest), fresh, { now: NOW_MS - 5 * 60_000 - 1 })).toBe(false);
  });

  it("requires reconciliation after a workspace restore", async () => {
    const manifest = await manifestFixture();
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest), {
      now: LATER, restoredAt: null,
    })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest), {
      now: LATER, restoredAt: NOW,
    })).toBe(false);
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest, { reconciledAt: LATER }), {
      now: LATER, restoredAt: NOW,
    })).toBe(true);
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest), {
      now: LATER, restoredAt: "not a time",
    })).toBe(false);
  });

  it("refuses an invalid clock value", async () => {
    const manifest = await manifestFixture();
    expect(reconciliationSatisfied(bill(manifest), receipt(manifest), { now: "not a time" })).toBe(false);
  });

  it("explains why a write is blocked", async () => {
    const manifest = await manifestFixture();
    expect(() => assertBillWritable(bill(manifest), receipt(manifest), { now: NOW })).not.toThrow();
    expect(() => assertBillWritable(bill(manifest), null, { now: NOW })).toThrow(/Reconcile this bill with the relay/);
    expect(() => assertBillWritable(bill(manifest), receipt(manifest), { now: LATER, restoredAt: LATER }))
      .toThrow(/restored from a backup/);
  });

  it("reads the receipt and the restore guard together", async () => {
    const manifest = await manifestFixture();
    await expect(requireWritableBill(bill(manifest), NOW)).rejects.toThrow(/Reconcile this bill with the relay/);
    await recordReconciliation(bill(manifest), NOW);
    await expect(requireWritableBill(bill(manifest), NOW)).resolves.toBeUndefined();
    await expect(requireWritableBill(bill(manifest), LATER)).resolves.toBeUndefined();
    await expect(requireWritableBill(
      bill(manifest),
      new Date(NOW_MS + MAX_RECONCILIATION_AGE_MS + 1).toISOString(),
    )).rejects.toThrow(/stale/);
  });
});

describe("unresolved participant reports", () => {
  it("treats a report without any confirmation as unresolved", () => {
    expect(hasUnresolvedReport(guarded([], []))).toBe(false);
    expect(hasUnresolvedReport(guarded([NOW], []))).toBe(true);
  });

  it("requires a confirmation at or after the latest report", () => {
    const at = "11111111-1111-4111-8111-111111111111";
    expect(hasUnresolvedReport(guarded([NOW], [{ id: at, at: NOW }]))).toBe(false);
    expect(hasUnresolvedReport(guarded([NOW], [{ id: at, at: LATER }]))).toBe(false);
    expect(hasUnresolvedReport(guarded([LATER], [{ id: at, at: NOW }]))).toBe(true);
    expect(hasUnresolvedReport(guarded([NOW, LATER], [{ id: at, at: LATER }]))).toBe(false);
  });

  it("breaks an exact timestamp tie by record identifier", () => {
    const low = "11111111-1111-4111-8111-111111111111";
    const high = "99999999-9999-4999-8999-999999999999";
    const state: Guarded = {
      reports: [report(high, NOW)],
      confirmations: [confirmation(low, NOW)],
    };
    expect(hasUnresolvedReport(state)).toBe(true);
    expect(hasUnresolvedReport({ ...state, reports: [report(low, NOW)] })).toBe(false);
  });

  it("blocks economic amendments while any request has an unresolved report", () => {
    const resolved = guarded([NOW], [{ id: "11111111-1111-4111-8111-111111111111", at: LATER }]);
    const unresolved = guarded([LATER], []);
    expect(() => assertEconomicAmendmentAllowed([resolved])).not.toThrow();
    expect(() => assertEconomicAmendmentAllowed([])).not.toThrow();
    expect(() => assertEconomicAmendmentAllowed([resolved, unresolved])).toThrow(/Resolve every participant payment report/);
    expect(() => assertEconomicAmendmentAllowed(null as never)).toThrow(/request inventory is invalid/);
  });
});

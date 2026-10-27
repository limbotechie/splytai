import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCrypto } from "../private-workspace/test-support";
import {
  exportEncryptedWorkspace,
  importEncryptedWorkspace,
  clearLocalWorkspaceOnly,
  deleteWorkspaceAndRelayData,
  getWorkspaceRecoveryStatus,
} from "./recovery";
import { createBill, listLocalBills, readEditCapability, readLocalBill, syncBill } from "./bill";
import { InMemoryRelayClient } from "./__tests__/relay";
import { TESTNET_SAPLING, NOW, receipt, participants } from "../requests/__tests__/fixtures";
import type { RelayClient } from "../requests/relay";
import { deleteRecord, readRecord } from "../private-workspace/storage";

vi.mock("@elemental-zcash/zaddr_wasm_parser", async () => {
  const { loadAddressParser } = await import("../zcash/__tests__/parser");
  return loadAddressParser();
});

const PASSPHRASE = "correct horse battery staple 123";

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("workspace recovery workflow", () => {
  async function setupBillWithRelay() {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Vacation rental",
      receipt: { ...receipt(), title: "Vacation rental" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "300000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 30,
    };
    const created = await createBill(relay, input, NOW);
    const billRecord = (await listLocalBills())[0];
    await syncBill(relay, billRecord, NOW);
    return { relay, created };
  }

  it("exports encrypted workspace and inspects recovery status", async () => {
    await setupBillWithRelay();
    const backupJson = await exportEncryptedWorkspace(PASSPHRASE);

    expect(typeof backupJson).toBe("string");
    const parsed = JSON.parse(backupJson);
    expect(parsed.format).toBe("splyt-private-workspace");
    expect(parsed.version).toBe(1);
    expect(parsed.kdf.name).toBe("PBKDF2");

    const status = await getWorkspaceRecoveryStatus();
    expect(status.lastExportAt).not.toBeNull();
  });

  it("imports backup into a fresh workspace and reconciles with relay", async () => {
    const { relay, created } = await setupBillWithRelay();
    const backupJson = await exportEncryptedWorkspace(PASSPHRASE);

    // Wipe local workspace to simulate a new device
    await clearLocalWorkspaceOnly();
    expect(await readLocalBill(created.billId)).toBeNull();

    // Import with relay reconciliation
    const result = await importEncryptedWorkspace(backupJson, PASSPHRASE, relay);
    expect(result.success).toBe(true);
    expect(result.reconciliation?.reconciledBills).toContain(created.billId);

    // Bill is restored locally
    const restored = await readLocalBill(created.billId);
    expect(restored).not.toBeNull();
    expect(restored?.manifest.title).toBe("Vacation rental");

    // Recovery status shows restored state
    const status = await getWorkspaceRecoveryStatus();
    expect(status.restoredAt).not.toBeNull();
  });

  it("deletes all bills on relay and locally", async () => {
    const { relay, created } = await setupBillWithRelay();
    const result = await deleteWorkspaceAndRelayData(relay, NOW);

    expect(result.deletedBills).toContain(created.billId);
    expect(result.failedBills).toHaveLength(0);

    const inMem = relay as unknown as InMemoryRelayClient;
    expect(inMem.bills.has(created.billId)).toBe(false);

    expect(await listLocalBills()).toHaveLength(0);
  });

  it("preserves local bills and edit capabilities when the real relay call fails", async () => {
    const { relay, created } = await setupBillWithRelay();
    const capability = await readEditCapability(created.billId);
    vi.spyOn(relay, "getBill").mockRejectedValueOnce(new Error("Relay offline"));
    const result = await deleteWorkspaceAndRelayData(relay, NOW);
    expect(result.deletedBills).toEqual([]);
    expect(result.failedBills).toEqual([{ billId: created.billId, error: "Relay offline" }]);
    expect(await readLocalBill(created.billId)).not.toBeNull();
    expect(await readEditCapability(created.billId)).toBe(capability);
    expect((relay as unknown as InMemoryRelayClient).bills.has(created.billId)).toBe(true);
  });

  it("reports missing edit capabilities instead of claiming remote deletion", async () => {
    const { relay, created } = await setupBillWithRelay();
    const capability = (await readRecord(`bill-edit:${created.billId}`))!;
    await deleteRecord(capability.id, capability.revision);
    const result = await deleteWorkspaceAndRelayData(relay, NOW);
    expect(result.deletedBills).toEqual([]);
    expect(result.failedBills).toMatchObject([{ billId: created.billId }]);
    expect(await readLocalBill(created.billId)).not.toBeNull();
    expect((relay as unknown as InMemoryRelayClient).bills.has(created.billId)).toBe(true);
  });

  it("distinguishes a successful local restore from failed relay reconciliation", async () => {
    const { relay, created } = await setupBillWithRelay();
    const backup = await exportEncryptedWorkspace(PASSPHRASE);
    await clearLocalWorkspaceOnly();
    vi.spyOn(relay, "getBill").mockRejectedValueOnce(new Error("Relay offline"));
    const result = await importEncryptedWorkspace(backup, PASSPHRASE, relay);
    expect(result.success).toBe(false);
    expect(result.reconciliation?.failedBills).toEqual([{ billId: created.billId, error: "Relay offline" }]);
    expect(await readLocalBill(created.billId)).not.toBeNull();
    expect(await readEditCapability(created.billId)).not.toBeNull();
  });
});

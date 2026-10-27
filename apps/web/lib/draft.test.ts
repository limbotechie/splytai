import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDraft, getDraft, getDraftCount, listDrafts, purgeOldDrafts, putDraft } from "./draft";
import type { DraftSession } from "./types";
import { randomId } from "./private-workspace/crypto";
import { captureWorkspace, clearWorkspace, readRecord, restoreWorkspaceRecords, writeRecord } from "./private-workspace/storage";
import { installCrypto, storedValues } from "./private-workspace/test-support";

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function draft(): DraftSession {
  return {
    id: randomId(),
    receipt: { title: "PRIVATE_DRAFT_FIXTURE", items: [{ name: "PRIVATE_ITEM_FIXTURE", amount: "12.00" }], subtotal: "12.00", tax: "0.00", total: "12.00", currency: "USD" },
    members: ["PRIVATE_MEMBER_FIXTURE"], includeOrganiser: false,
    mode: "equal", amounts: [], expiresInMinutes: 60, createdAt: Date.now(),
  };
}

describe("real encrypted draft persistence", () => {
  it("starts empty and never opens the template-era database", async () => {
    const open = vi.spyOn(window.indexedDB, "open");
    expect(await listDrafts()).toEqual([]);
    expect(await getDraftCount()).toBe(0);
    expect(await getDraft(randomId())).toBeNull();
    expect(open).toHaveBeenCalled();
    expect(open.mock.calls.every(([name]) => name === "splyt-private-v1")).toBe(true);
  });

  it("stores only encrypted records and returns actual user-entered drafts", async () => {
    const value = draft();
    await putDraft(value);
    expect(await getDraft(value.id)).toEqual(value);
    expect(await getDraftCount()).toBe(1);
    const raw = JSON.stringify(await storedValues("records"));
    expect(raw).toContain('"ciphertext"');
    for (const plaintext of [value.receipt.title!, value.receipt.items[0].name, value.members[0]]) expect(raw).not.toContain(plaintext);

    const updated = { ...value, includeOrganiser: true, organiserCustomAmount: "4.00" };
    await putDraft(updated);
    expect(await getDraft(value.id)).toEqual(updated);
    expect((await readRecord(`draft:${value.id}`))?.revision).toBe(2);
  });

  it("includes drafts in recovery inventory and workspace clearing", async () => {
    const value = draft();
    await putDraft(value);
    const snapshot = await captureWorkspace();
    expect(snapshot.records).toEqual([{ id: `draft:${value.id}`, revision: 1, value }]);
    await clearWorkspace();
    expect(await listDrafts()).toEqual([]);
    await restoreWorkspaceRecords(snapshot.records, snapshot.capturedAt);
    expect(await getDraft(value.id)).toEqual(value);
  });

  it("reports unavailable storage instead of pretending writes succeeded or lists are empty", async () => {
    const value = draft();
    installCrypto();
    await expect(putDraft(value)).rejects.toThrow(/secure browser/);
    await expect(getDraft(value.id)).rejects.toThrow(/secure browser/);
    await expect(deleteDraft(value.id)).rejects.toThrow(/secure browser/);
    await expect(listDrafts()).rejects.toThrow(/secure browser/);
    await expect(getDraftCount()).rejects.toThrow(/secure browser/);
  });

  it("deletes only selected old drafts and preserves unrelated workspace records", async () => {
    const old = { ...draft(), createdAt: Date.now() - 8 * 86_400_000 };
    const recent = draft();
    await putDraft(old);
    await putDraft(recent);
    await writeRecord("bill:unrelated", { untouched: true }, null);
    await purgeOldDrafts(7);
    expect(await listDrafts()).toEqual([recent]);
    expect((await readRecord("bill:unrelated"))?.value).toEqual({ untouched: true });
    await deleteDraft(recent.id);
    expect(await getDraftCount()).toBe(0);
  });
});

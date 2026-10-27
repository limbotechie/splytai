import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertBrowserSupport, decodeBase64Url, encodeBase64Url, randomSecret, type EncryptedEnvelope } from "./crypto";
import {
  clearWorkspace, deleteRecord, listRecords, readRecord, workspaceSupport, WorkspaceConflictError, writeRecord,
} from "./storage";
import { MAX_RECORD_BYTES } from "./format";
import { deferred, installCrypto, mutateStore, nativeCrypto, storedValues } from "./test-support";

interface PersistedRecord { id: string; revision: number; envelope: EncryptedEnvelope | null }
interface PersistedKey { key: CryptoKey; generation: string }

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("encrypted IndexedDB workspace", () => {
  it("checks actual key cloning and encrypted persistence without creating business or recovery records", async () => {
    await expect(workspaceSupport()).resolves.toBe(true);
    await expect(assertBrowserSupport()).resolves.toBeUndefined();
    expect(await listRecords()).toEqual([]);
    expect(await storedValues("records")).toEqual([]);
    expect(await storedValues("metadata")).toEqual([]);
    expect(await storedValues("keys")).toHaveLength(1);
  });

  it("reports missing, denied, insecure, and server-side browser support", async () => {
    vi.spyOn(window.indexedDB, "open").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    await expect(workspaceSupport()).resolves.toBe(false);
    vi.restoreAllMocks();
    vi.stubGlobal("window", { ...window, isSecureContext: false });
    await expect(workspaceSupport()).resolves.toBe(false);
    vi.stubGlobal("window", undefined);
    await expect(workspaceSupport()).resolves.toBe(false);
    await expect(readRecord("bill:a")).rejects.toThrow("secure browser");
  });

  it("stores only envelopes and a nonextractable structured-cloned AES256 key", async () => {
    const secret = randomSecret();
    const localStorage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", localStorage);
    const value = { receipt: "PRIVATE_RECEIPT_FIXTURE", destination: "PRIVATE_ADDRESS_FIXTURE", contentKey: secret };
    await writeRecord("bill:a", value, null);
    const [key] = await storedValues<PersistedKey>("keys");
    expect(key.key).toBeInstanceOf(CryptoKey);
    expect(key.key.extractable).toBe(false);
    expect(key.key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    await expect(nativeCrypto.subtle.exportKey("raw", key.key)).rejects.toThrow();
    const stored = await storedValues<PersistedRecord>("records");
    expect(stored[0]).toMatchObject({ id: "bill:a", revision: 1, envelope: { version: 1, kind: "local", recordId: "bill:a", revision: 1 } });
    const raw = JSON.stringify([stored, await storedValues("keys"), await storedValues("metadata")]);
    for (const plaintext of [value.receipt, value.destination, secret]) expect(raw).not.toContain(plaintext);
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).not.toHaveBeenCalled();
    expect(await readRecord("bill:a")).toEqual({ id: "bill:a", revision: 1, value });
  });

  it("supports create/read/update/list-prefix with deterministic ID order and new nonces", async () => {
    expect(await readRecord("bill:missing")).toBeNull();
    const a = await writeRecord("bill:a", { amount: "1" }, null);
    await writeRecord("request:a", ["own request"], null);
    await writeRecord("bill:b", null, null);
    const before = (await storedValues<PersistedRecord>("records"))[0].envelope;
    const updated = await writeRecord(a.id, { amount: "2" }, a.revision);
    expect(updated).toEqual({ id: "bill:a", revision: 2, value: { amount: "2" } });
    const after = (await storedValues<PersistedRecord>("records"))[0].envelope;
    expect(after?.nonce).not.toBe(before?.nonce);
    expect((await listRecords("bill:")).map((record) => record.id)).toEqual(["bill:a", "bill:b"]);
    expect((await listRecords()).map((record) => record.id)).toEqual(["bill:a", "bill:b", "request:a"]);
    expect(await listRecords("does-not-exist")).toEqual([]);
  });

  it("snapshots writes before awaiting and does not retain returned object references", async () => {
    const value = { nested: { amount: "1" } };
    const pending = writeRecord("bill:a", value, null);
    value.nested.amount = "changed during write";
    const written = await pending;
    written.value.nested.amount = "changed after write";
    expect((await readRecord("bill:a"))?.value).toEqual({ nested: { amount: "1" } });
  });

  it("makes null create-only, requires explicit CAS updates/deletes, and rejects stale revisions", async () => {
    const record = await writeRecord("bill:a", {}, null);
    await expect(writeRecord(record.id, {}, null)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(writeRecord(record.id, {}, 2)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(writeRecord("missing", {}, 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(writeRecord(record.id, {}, undefined as unknown as number)).rejects.toThrow("revision");
    await expect(deleteRecord(record.id, undefined as unknown as number)).rejects.toThrow("revision");
    await expect(deleteRecord(record.id, 2)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(deleteRecord("missing", 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect((await readRecord(record.id))?.revision).toBe(1);
  });

  it("atomically allows only one concurrent creator across independent connections", async () => {
    const outcomes = await Promise.allSettled([
      writeRecord("bill:race", { author: "first" }, null),
      writeRecord("bill:race", { author: "second" }, null),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(WorkspaceConflictError);
    expect(await storedValues("keys")).toHaveLength(1);
    expect(await listRecords()).toHaveLength(1);
  });

  it("atomically allows only one concurrent updater at a revision", async () => {
    await writeRecord("bill:race", { amount: "0" }, null);
    const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => writeRecord("bill:race", { amount: String(index + 1) }, 1)));
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(7);
    expect((await readRecord("bill:race"))?.revision).toBe(2);
  });

  it("atomically arbitrates an update versus delete", async () => {
    await writeRecord("bill:race", {}, null);
    const results = await Promise.allSettled([writeRecord("bill:race", { updated: true }, 1), deleteRecord("bill:race", 1)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("retains only revision tombstones and prevents delete/recreate ABA conflicts", async () => {
    await writeRecord("bill:a", { secret: "erased" }, null);
    await deleteRecord("bill:a", 1);
    expect(await readRecord("bill:a")).toBeNull();
    expect(await listRecords()).toEqual([]);
    expect(await storedValues("records")).toEqual([{ id: "bill:a", revision: 2, envelope: null }]);
    const recreated = await writeRecord("bill:a", { new: true }, null);
    expect(recreated.revision).toBe(3);
    await expect(writeRecord("bill:a", { stale: true }, 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(deleteRecord("bill:a", 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
  });

  it("rejects unsafe IDs, prefixes, revisions, oversized records, and non-JSON values", async () => {
    for (const id of ["", "a".repeat(201), "space id", "line\n", "\u0000", "../path"]) {
      await expect(writeRecord(id, {}, null)).rejects.toThrow("ID");
    }
    for (const revision of [-1, 0, 1.5, NaN, Infinity]) await expect(writeRecord("id", {}, revision)).rejects.toThrow("revision");
    await expect(writeRecord("id", { no: undefined }, null)).rejects.toThrow("JSON");
    await expect(writeRecord("id", "x".repeat(MAX_RECORD_BYTES), null)).rejects.toThrow("too large");
    await expect(listRecords("bad prefix")).rejects.toThrow("prefix");
    expect(await listRecords()).toEqual([]);
  });

  it("fails closed on identity substitution and corrupted ciphertext", async () => {
    await writeRecord("bill:a", { value: "private" }, null);
    const [record] = await storedValues<PersistedRecord>("records");
    const envelope = record.envelope as EncryptedEnvelope;
    await mutateStore("records", (store) => store.put({ ...record, envelope: { ...envelope, recordId: "other" } }));
    await expect(readRecord(record.id)).rejects.toThrow("envelope");
    const bytes = decodeBase64Url(envelope.ciphertext);
    bytes[0] ^= 1;
    await mutateStore("records", (store) => store.put({ ...record, envelope: { ...envelope, ciphertext: encodeBase64Url(bytes) } }));
    await expect(readRecord(record.id)).rejects.toThrow("Unable to decrypt");
  });

  it("does not replace a lost or malformed key when encrypted data already exists", async () => {
    await writeRecord("bill:a", { secret: "retained" }, null);
    const before = await storedValues("records");
    await mutateStore("keys", (store) => store.clear());
    await expect(readRecord("bill:a")).rejects.toThrow("key is missing");
    expect(await storedValues("keys")).toEqual([]);
    expect(await storedValues("records")).toEqual(before);
    await mutateStore("keys", (store) => store.put({ generation: "bad", key: "plaintext" }, "local"));
    await expect(readRecord("bill:a")).rejects.toThrow("key is missing or invalid");
  });

  it("clears only this workspace's stores and rotates the local key on the next use", async () => {
    await writeRecord("bill:a", {}, null);
    const [before] = await storedValues<PersistedKey>("keys");
    await clearWorkspace();
    for (const store of ["keys", "records", "metadata"]) expect(await storedValues(store)).toEqual([]);
    await writeRecord("bill:b", {}, null);
    const [after] = await storedValues<PersistedKey>("keys");
    expect(after.generation).not.toBe(before.generation);
    expect(await readRecord("bill:a")).toBeNull();
  });

  it("rejects an in-flight write encrypted under a key cleared by another tab", async () => {
    await writeRecord("bill:a", { amount: "1" }, null);
    const started = deferred();
    const release = deferred();
    const encrypt = nativeCrypto.subtle.encrypt.bind(nativeCrypto.subtle);
    vi.spyOn(nativeCrypto.subtle, "encrypt").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      return encrypt(...args);
    });
    const write = writeRecord("bill:a", { amount: "2" }, 1);
    await started.promise;
    await clearWorkspace();
    release.resolve();
    await expect(write).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await listRecords()).toEqual([]);
  });
});

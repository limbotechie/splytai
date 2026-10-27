import { IDBFactory, IDBKeyRange as FakeKeyRange, IDBObjectStore as FakeObjectStore } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeBase64Url, encodeBase64Url, encryptJson, generateSigningKeys, randomSecret, type EncryptedEnvelope,
} from "./crypto";
import {
  exportWorkspace, importWorkspace, MAX_RECOVERY_BYTES, RECOVERY_ITERATIONS, recoveryMetadata, recoveryStatus,
} from "./recovery";
import { clearWorkspace, deleteRecord, listRecords, readRecord, WorkspaceConflictError, writeRecord } from "./storage";
import { MAX_RECORD_BYTES, MAX_RECORDS } from "./format";
import { deferred, installCrypto, nativeCrypto, storedValues } from "./test-support";

const PASSPHRASE = "correct horse fixture battery";
const EXPORTED_AT = "2026-10-23T23:00:00.000Z";
const OPEN_ERROR = "Unable to open this recovery file. Check the passphrase and that the file is intact.";
const CONTEXT = { kind: "recovery" as const, recordId: "splyt-private-workspace", revision: 1 };
interface FileShape {
  version: number;
  format: string;
  kdf: { name: string; hash: string; iterations: number; salt: string };
  envelope: EncryptedEnvelope;
}

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function sealFixture(payload: unknown): Promise<string> {
  const salt = nativeCrypto.getRandomValues(new Uint8Array(16));
  const material = await nativeCrypto.subtle.importKey("raw", new TextEncoder().encode(PASSPHRASE), "PBKDF2", false, ["deriveKey"]);
  const key = await nativeCrypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_ITERATIONS, salt }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  return JSON.stringify({
    version: 1, format: "splyt-private-workspace",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_ITERATIONS, salt: encodeBase64Url(salt) },
    envelope: await encryptJson(key, payload, CONTEXT),
  });
}

describe("encrypted workspace recovery", () => {
  it("round trips the complete key inventory under a new nonextractable local key with an atomic restore guard", async () => {
    const signing = await generateSigningKeys();
    const inventory = {
      bill: { title: "PRIVATE_BILL_FIXTURE", amount: "123456" }, contentKey: randomSecret(),
      organiserCapability: randomSecret(), requestKeys: [randomSecret()], signing,
    };
    const record = await writeRecord("bill:fixture", inventory, null);
    await writeRecord("settings", { network: "testnet" }, null);
    const [oldKey] = await storedValues<{ generation: string; key: CryptoKey }>("keys");
    const file = await exportWorkspace(PASSPHRASE);
    const wire = JSON.parse(file) as FileShape;
    expect(wire).toMatchObject({ version: 1, format: "splyt-private-workspace", kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000 } });
    expect(decodeBase64Url(wire.kdf.salt)).toHaveLength(16);
    expect(decodeBase64Url(wire.envelope.nonce)).toHaveLength(12);
    for (const plaintext of [PASSPHRASE, inventory.bill.title, inventory.contentKey, inventory.organiserCapability, signing.privateKey.d as string]) {
      expect(file).not.toContain(plaintext);
    }
    const status = await recoveryStatus();
    expect(status.uncoveredRecords).toBe(0);
    await clearWorkspace();
    await importWorkspace(file, PASSPHRASE);
    expect(await readRecord(record.id)).toEqual(record);
    expect(await listRecords()).toHaveLength(2);
    const [newKey] = await storedValues<{ generation: string; key: CryptoKey }>("keys");
    expect(newKey.generation).not.toBe(oldKey.generation);
    expect(newKey.key.extractable).toBe(false);
    await expect(nativeCrypto.subtle.exportKey("raw", newKey.key)).rejects.toThrow();
    const metadata = await recoveryMetadata();
    expect(metadata.requiresRemoteRefresh).toBe(true);
    expect(metadata.exportedAt).toBe(status.lastExportAt);
    expect(Number.isFinite(Date.parse(metadata.restoredAt as string))).toBe(true);
    expect(await recoveryStatus()).toEqual(status);
    const rawMetadata = JSON.stringify(await storedValues("metadata"));
    expect(rawMetadata).not.toContain("requiresRemoteRefresh");
    expect(rawMetadata).not.toContain("PRIVATE_BILL_FIXTURE");
  });

  it("uses fresh salt and nonce on every export without changing business revisions or marking metadata dirty", async () => {
    await writeRecord("bill:a", { value: "unchanged" }, null);
    const before = await listRecords();
    const first = JSON.parse(await exportWorkspace(PASSPHRASE)) as FileShape;
    const second = JSON.parse(await exportWorkspace(PASSPHRASE)) as FileShape;
    expect(second.kdf.salt).not.toBe(first.kdf.salt);
    expect(second.envelope.nonce).not.toBe(first.envelope.nonce);
    expect(second.envelope.ciphertext).not.toBe(first.envelope.ciphertext);
    expect(await listRecords()).toEqual(before);
    expect((await recoveryStatus()).uncoveredRecords).toBe(0);
    expect(await recoveryMetadata()).toEqual({ restoredAt: null, exportedAt: null, requiresRemoteRefresh: false });
  });

  it("tracks new, updated, deleted, and recreated records against exact snapshot coverage", async () => {
    expect(await recoveryStatus()).toEqual({ lastExportAt: null, uncoveredRecords: 0 });
    await writeRecord("bill:a", {}, null);
    expect((await recoveryStatus()).uncoveredRecords).toBe(1);
    await exportWorkspace(PASSPHRASE);
    await writeRecord("bill:a", { updated: true }, 1);
    await writeRecord("bill:b", {}, null);
    expect((await recoveryStatus()).uncoveredRecords).toBe(2);
    await exportWorkspace(PASSPHRASE);
    await deleteRecord("bill:a", 2);
    expect((await recoveryStatus()).uncoveredRecords).toBe(1);
    await writeRecord("bill:a", { recreated: true }, null);
    expect((await recoveryStatus()).uncoveredRecords).toBe(1);
    await exportWorkspace(PASSPHRASE);
    expect((await recoveryStatus()).uncoveredRecords).toBe(0);
  });

  it("does not claim that writes made during an export's KDF were included in its snapshot", async () => {
    await writeRecord("bill:a", { version: "before" }, null);
    const started = deferred();
    const release = deferred();
    const derive = nativeCrypto.subtle.deriveKey.bind(nativeCrypto.subtle);
    vi.spyOn(nativeCrypto.subtle, "deriveKey").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      return derive(...args);
    });
    const exporting = exportWorkspace(PASSPHRASE);
    await started.promise;
    await writeRecord("bill:a", { version: "after" }, 1);
    await writeRecord("bill:newer", {}, null);
    release.resolve();
    const file = await exporting;
    expect((await recoveryStatus()).uncoveredRecords).toBe(2);
    await clearWorkspace();
    await importWorkspace(file, PASSPHRASE);
    expect((await readRecord("bill:a"))?.value).toEqual({ version: "before" });
    expect(await readRecord("bill:newer")).toBeNull();
    expect((await recoveryMetadata()).requiresRemoteRefresh).toBe(true);
  });

  it("serializes concurrent export metadata updates without losing business records", async () => {
    await writeRecord("bill:a", {}, null);
    const files = await Promise.all([exportWorkspace(PASSPHRASE), exportWorkspace(PASSPHRASE)]);
    expect(files).toHaveLength(2);
    expect(files[0]).not.toBe(files[1]);
    expect((await recoveryStatus()).uncoveredRecords).toBe(0);
    expect((await readRecord("bill:a"))?.revision).toBe(1);
  });

  it("will not attach old export coverage to a workspace cleared during encryption", async () => {
    await writeRecord("bill:a", {}, null);
    const started = deferred();
    const release = deferred();
    const derive = nativeCrypto.subtle.deriveKey.bind(nativeCrypto.subtle);
    vi.spyOn(nativeCrypto.subtle, "deriveKey").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      return derive(...args);
    });
    const exporting = exportWorkspace(PASSPHRASE);
    await started.promise;
    await clearWorkspace();
    release.resolve();
    await expect(exporting).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await storedValues("metadata")).toEqual([]);
  });

  it("requires an explicitly clean workspace and rejects even an empty existing backup's metadata", async () => {
    await writeRecord("bill:a", { keep: true }, null);
    const file = await exportWorkspace(PASSPHRASE);
    const derive = vi.spyOn(nativeCrypto.subtle, "deriveKey");
    await expect(importWorkspace(file, PASSPHRASE)).rejects.toThrow("clean workspace");
    expect(derive).not.toHaveBeenCalled();
    expect((await readRecord("bill:a"))?.value).toEqual({ keep: true });
    await clearWorkspace();
    await exportWorkspace(PASSPHRASE);
    await expect(importWorkspace(file, PASSPHRASE)).rejects.toThrow("clean workspace");
  });

  it("rechecks clean storage atomically if another tab creates a record during import", async () => {
    await writeRecord("bill:backup", { from: "backup" }, null);
    const file = await exportWorkspace(PASSPHRASE);
    await clearWorkspace();
    const started = deferred();
    const release = deferred();
    const derive = nativeCrypto.subtle.deriveKey.bind(nativeCrypto.subtle);
    vi.spyOn(nativeCrypto.subtle, "deriveKey").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      return derive(...args);
    });
    const importing = importWorkspace(file, PASSPHRASE);
    await started.promise;
    await writeRecord("bill:live", { from: "other tab" }, null);
    const [key] = await storedValues<{ generation: string }>("keys");
    release.resolve();
    await expect(importing).rejects.toThrow("clean workspace");
    expect(await readRecord("bill:backup")).toBeNull();
    expect((await readRecord("bill:live"))?.value).toEqual({ from: "other tab" });
    expect((await storedValues<{ generation: string }>("keys"))[0].generation).toBe(key.generation);
    expect(await storedValues("metadata")).toEqual([]);
  });

  it("rejects wrong passphrases and authenticated corruption with the same generic error and no writes", async () => {
    const file = await exportWorkspace(PASSPHRASE);
    await clearWorkspace();
    await expect(importWorkspace(file, "a different long passphrase")).rejects.toThrow(OPEN_ERROR);
    const wire = JSON.parse(file) as FileShape;
    const ciphertext = decodeBase64Url(wire.envelope.ciphertext);
    ciphertext[ciphertext.length - 1] ^= 1;
    wire.envelope.ciphertext = encodeBase64Url(ciphertext);
    await expect(importWorkspace(JSON.stringify(wire), PASSPHRASE)).rejects.toThrow(OPEN_ERROR);
    for (const store of ["keys", "records", "metadata"]) expect(await storedValues(store)).toEqual([]);
  });

  it("validates size, version, fixed bounded KDF, salt, and envelope before performing any KDF", async () => {
    const wire = JSON.parse(await exportWorkspace(PASSPHRASE)) as FileShape;
    await clearWorkspace();
    const derive = vi.spyOn(nativeCrypto.subtle, "deriveKey");
    const invalid = [
      null, [], {}, { ...wire, version: 2 }, { ...wire, format: "another-product" }, { ...wire, extra: true },
      ...[0, 1, 599_999, 600_001, Number.MAX_SAFE_INTEGER, "600000"].map((iterations) => ({ ...wire, kdf: { ...wire.kdf, iterations } })),
      { ...wire, kdf: { ...wire.kdf, hash: "SHA-1" } }, { ...wire, kdf: { ...wire.kdf, name: "scrypt" } },
      { ...wire, kdf: { ...wire.kdf, salt: encodeBase64Url(new Uint8Array(15)) } },
      { ...wire, kdf: { ...wire.kdf, salt: `${wire.kdf.salt}=` } },
      { ...wire, envelope: { ...wire.envelope, kind: "local" } },
      { ...wire, envelope: { ...wire.envelope, recordId: "different" } },
      { ...wire, envelope: { ...wire.envelope, revision: 2 } },
      { ...wire, envelope: { ...wire.envelope, nonce: encodeBase64Url(new Uint8Array(13)) } },
      { ...wire, envelope: { ...wire.envelope, ciphertext: "" } },
    ];
    for (const value of invalid) await expect(importWorkspace(JSON.stringify(value), PASSPHRASE)).rejects.toThrow(OPEN_ERROR);
    await expect(importWorkspace("x".repeat(MAX_RECOVERY_BYTES + 1), PASSPHRASE)).rejects.toThrow(OPEN_ERROR);
    await expect(importWorkspace("\u00e9".repeat(MAX_RECOVERY_BYTES / 2 + 1), PASSPHRASE)).rejects.toThrow(OPEN_ERROR);
    expect(derive).not.toHaveBeenCalled();
    expect(await storedValues("records")).toEqual([]);
  });

  it.each([
    ["duplicate IDs", { records: [{ id: "bill:a", revision: 1, value: {} }, { id: "bill:a", revision: 1, value: {} }] }],
    ["empty ID", { records: [{ id: "", revision: 1, value: {} }] }],
    ["zero revision", { records: [{ id: "bill:a", revision: 0, value: {} }] }],
    ["missing value", { records: [{ id: "bill:a", revision: 1 }] }],
    ["unknown record field", { records: [{ id: "bill:a", revision: 1, value: {}, unexpected: true }] }],
    ["oversized record", { records: [{ id: "bill:a", revision: 1, value: "x".repeat(MAX_RECORD_BYTES) }] }],
    ["excess record count", { records: Array.from({ length: MAX_RECORDS + 1 }, (_, index) => ({ id: `record:${index}`, revision: 1, value: null })) }],
    ["invalid date", { exportedAt: "2026-02-30T00:00:00.000Z" }],
    ["unsupported version", { version: 2 }],
    ["unknown metadata field", { extra: true }],
  ] as const)("rejects authenticated recovery payloads with %s", async (_label, invalid) => {
    const base = { version: 1, exportedAt: EXPORTED_AT, records: [{ id: "bill:a", revision: 1, value: {} }] };
    await expect(importWorkspace(await sealFixture({ ...base, ...invalid }), PASSPHRASE)).rejects.toThrow(OPEN_ERROR);
    expect(await storedValues("records")).toEqual([]);
    expect(await storedValues("metadata")).toEqual([]);
  });

  it("rolls back key, restore metadata, and all records if any IndexedDB import write fails", async () => {
    await writeRecord("bill:a", {}, null);
    await writeRecord("bill:b", {}, null);
    const file = await exportWorkspace(PASSPHRASE);
    await clearWorkspace();
    const add = FakeObjectStore.prototype.add;
    vi.spyOn(FakeObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "records" && (value as { id: string }).id === "bill:b") {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return add.call(this, value, key);
    });
    await expect(importWorkspace(file, PASSPHRASE)).rejects.toThrow();
    for (const store of ["keys", "records", "metadata"]) expect(await storedValues(store)).toEqual([]);
  });

  it("enforces a 12-character minimum, rejects blank/oversized passphrases, and never normalizes them", async () => {
    const derive = vi.spyOn(nativeCrypto.subtle, "deriveKey");
    for (const passphrase of ["", "elevenchars", " ".repeat(12), "x".repeat(1025)]) {
      await expect(exportWorkspace(passphrase)).rejects.toThrow("12 characters");
    }
    expect(derive).not.toHaveBeenCalled();
    const passphrase = "  exact phrase including spaces  ";
    const file = await exportWorkspace(passphrase);
    await clearWorkspace();
    await expect(importWorkspace(file, passphrase.trim())).rejects.toThrow(OPEN_ERROR);
    await expect(importWorkspace(file, passphrase)).resolves.toBeUndefined();
  });

  it("allows support-initialized empty storage, preserves generic JSON values, and keeps restore guards after re-export", async () => {
    const file = await sealFixture({ version: 1, exportedAt: EXPORTED_AT, records: [
      { id: "settings", revision: 5, value: [true, "value", null, 123] },
      { id: "bill:a", revision: 2, value: JSON.parse('{"__proto__":{"polluted":true}}') },
    ] });
    await readRecord("missing");
    await importWorkspace(file, PASSPHRASE);
    expect((await readRecord("settings"))?.revision).toBe(5);
    expect((await readRecord("settings"))?.value).toEqual([true, "value", null, 123]);
    expect(Object.prototype).not.toHaveProperty("polluted");
    await exportWorkspace(PASSPHRASE);
    expect((await recoveryMetadata()).requiresRemoteRefresh).toBe(true);
    expect((await recoveryMetadata()).exportedAt).toBe(EXPORTED_AT);
    expect((await recoveryStatus()).uncoveredRecords).toBe(0);
  });
});

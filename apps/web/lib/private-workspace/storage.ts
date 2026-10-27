import { decryptJson, encryptJson, randomId, type EncryptedEnvelope } from "./crypto";
import {
  assertRecordId, assertRevision, canonicalJson, decodeBase64Url, hasExactKeys,
  isTimestamp, MAX_RECORDS, validateEnvelope, validateLocalRecord,
} from "./format";

export interface LocalRecord<T = unknown> {
  id: string;
  revision: number;
  value: T;
}

export class WorkspaceConflictError extends Error {
  constructor() {
    super("The workspace changed. Reload the record before trying again.");
    this.name = "WorkspaceConflictError";
  }
}

const DATABASE = "splyt-private-v1";
const STORES = ["keys", "records", "metadata"];
const LOCAL_KEY = "local";
const RECOVERY_STATE = "recovery";
const METADATA_ID = "workspace:recovery-metadata";

interface StoredKey {
  generation: string;
  key: CryptoKey;
}

interface StoredRecord {
  id: string;
  revision: number;
  envelope: EncryptedEnvelope | null;
}

interface StoredMetadata {
  revision: number;
  envelope: EncryptedEnvelope;
}

interface Coverage {
  id: string;
  revision: number;
  nonce: string;
}

interface RecoveryState {
  lastExportAt: string | null;
  coverage: Coverage[];
  restoredAt: string | null;
  sourceExportedAt: string | null;
  requiresRemoteRefresh: boolean;
}

/** Internal snapshot shared with recovery.ts, never a wire/export format. */
export interface WorkspaceSnapshot {
  records: LocalRecord[];
  coverage: Coverage[];
  generation: string;
  capturedAt: string;
  recovery: RecoveryState;
}

function openDatabase(): Promise<IDBDatabase> {
  if (
    typeof window === "undefined" || window.isSecureContext !== true ||
    !window.crypto?.subtle || typeof window.indexedDB?.open !== "function"
  ) return Promise.reject(new Error("A secure browser with IndexedDB and WebCrypto is required."));
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE, 1);
    let abandoned = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("keys");
      database.createObjectStore("records", { keyPath: "id" });
      database.createObjectStore("metadata");
    };
    request.onerror = () => reject(new Error("The private workspace could not be opened."));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Another tab is blocking the workspace. Close it and try again."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (abandoned) return database.close();
      database.onversionchange = () => database.close();
      if (database.objectStoreNames.length !== STORES.length || STORES.some((store) => !database.objectStoreNames.contains(store))) {
        database.close();
        return reject(new Error("The private workspace format is invalid."));
      }
      resolve(database);
    };
  });
}

async function withDatabase<T>(operation: (database: IDBDatabase) => Promise<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await operation(database);
  } finally {
    database.close();
  }
}

function transaction<T>(
  database: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  operation: (tx: IDBTransaction, result: (value: T) => void, abort: (reason: unknown) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(stores, mode);
    let result: T;
    let finished = false;
    let failure: unknown;
    const abort = (reason: unknown) => {
      failure = reason;
      try { tx.abort(); } catch { reject(reason); }
    };
    tx.oncomplete = () => finished ? resolve(result) : reject(new Error("Workspace transaction did not finish."));
    tx.onabort = () => reject(failure ?? new Error("The workspace write failed. No changes were saved."));
    try {
      operation(tx, (value) => { result = value; finished = true; }, abort);
    } catch (error) {
      abort(error);
    }
  });
}

function afterRequests(requests: IDBRequest[], operation: () => void, abort: (reason: unknown) => void): void {
  let pending = requests.length;
  for (const request of requests) {
    request.onsuccess = () => {
      if (--pending) return;
      try { operation(); } catch (error) { abort(error); }
    };
  }
}

function storedKey(value: unknown): StoredKey {
  if (value === undefined) throw new WorkspaceConflictError();
  if (
    !hasExactKeys(value, ["generation", "key"]) || typeof value.generation !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.generation) ||
    typeof CryptoKey === "undefined" || !(value.key instanceof CryptoKey) ||
    value.key.type !== "secret" || value.key.extractable || value.key.algorithm.name !== "AES-GCM" ||
    (value.key.algorithm as AesKeyAlgorithm).length !== 256 || value.key.usages.length !== 2 ||
    !value.key.usages.includes("encrypt") || !value.key.usages.includes("decrypt")
  ) throw new Error("The local encryption key is missing or invalid. Restore an encrypted recovery file into a clean workspace.");
  return { generation: value.generation, key: value.key };
}

async function newLocalKey(): Promise<StoredKey> {
  // Profile-local encryption does not protect against same-origin scripts or control of the browser profile.
  const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { key, generation: randomId() };
}

async function ensureKey(database: IDBDatabase): Promise<StoredKey> {
  const existing = await transaction<unknown>(database, ["keys"], "readonly", (tx, done, abort) => {
    const request = tx.objectStore("keys").get(LOCAL_KEY);
    afterRequests([request], () => done(request.result), abort);
  });
  if (existing !== undefined) return storedKey(existing);
  const candidate = await newLocalKey();
  await transaction<void>(database, STORES, "readwrite", (tx, done, abort) => {
    const keys = tx.objectStore("keys");
    const key = keys.get(LOCAL_KEY);
    const records = tx.objectStore("records").count();
    const metadata = tx.objectStore("metadata").count();
    afterRequests([key, records, metadata], () => {
      if (key.result !== undefined) storedKey(key.result);
      else {
        if (records.result || metadata.result) throw new Error("The workspace encryption key is missing. Existing records were not replaced.");
        keys.add(candidate, LOCAL_KEY);
      }
      done(undefined);
    }, abort);
  });
  // Read back the structured clone, rather than assuming the browser can persist a CryptoKey.
  return transaction<StoredKey>(database, ["keys"], "readonly", (tx, done, abort) => {
    const request = tx.objectStore("keys").get(LOCAL_KEY);
    afterRequests([request], () => done(storedKey(request.result)), abort);
  });
}

function storedRecord(value: unknown, expectedId?: string): StoredRecord | undefined {
  if (value === undefined) return undefined;
  if (!hasExactKeys(value, ["id", "revision", "envelope"])) throw new Error("Invalid stored record.");
  assertRecordId(value.id);
  assertRevision(value.revision, 1);
  if (expectedId !== undefined && value.id !== expectedId) throw new Error("Invalid stored record ID.");
  const envelope = value.envelope === null ? null : validateEnvelope(value.envelope, {
    kind: "local", recordId: value.id, revision: value.revision,
  });
  return { id: value.id, revision: value.revision, envelope };
}

function storedMetadata(value: unknown): StoredMetadata | undefined {
  if (value === undefined) return undefined;
  if (!hasExactKeys(value, ["revision", "envelope"])) throw new Error("Invalid recovery metadata.");
  assertRevision(value.revision, 1);
  return {
    revision: value.revision,
    envelope: validateEnvelope(value.envelope, { kind: "local", recordId: METADATA_ID, revision: value.revision }),
  };
}

async function recoveryState(key: CryptoKey, metadata?: StoredMetadata): Promise<RecoveryState> {
  if (!metadata) return { lastExportAt: null, coverage: [], restoredAt: null, sourceExportedAt: null, requiresRemoteRefresh: false };
  const value = await decryptJson<unknown>(key, metadata.envelope, {
    kind: "local", recordId: METADATA_ID, revision: metadata.revision,
  });
  if (
    !hasExactKeys(value, ["lastExportAt", "coverage", "restoredAt", "sourceExportedAt", "requiresRemoteRefresh"]) ||
    (value.lastExportAt !== null && !isTimestamp(value.lastExportAt)) ||
    (value.restoredAt !== null && !isTimestamp(value.restoredAt)) ||
    (value.sourceExportedAt !== null && !isTimestamp(value.sourceExportedAt)) ||
    typeof value.requiresRemoteRefresh !== "boolean" || !Array.isArray(value.coverage) || value.coverage.length > MAX_RECORDS ||
    (value.lastExportAt === null && value.coverage.length !== 0) ||
    (value.restoredAt === null ? value.sourceExportedAt !== null || value.requiresRemoteRefresh : value.sourceExportedAt === null || !value.requiresRemoteRefresh)
  ) throw new Error("Invalid recovery metadata.");
  const ids = new Set<string>();
  const coverage = value.coverage.map((entry: unknown) => {
    if (!hasExactKeys(entry, ["id", "revision", "nonce"])) throw new Error("Invalid recovery coverage.");
    assertRecordId(entry.id);
    assertRevision(entry.revision, 1);
    if (ids.has(entry.id) || typeof entry.nonce !== "string" || decodeBase64Url(entry.nonce).length !== 12) {
      throw new Error("Invalid recovery coverage.");
    }
    ids.add(entry.id);
    return { id: entry.id, revision: entry.revision, nonce: entry.nonce };
  });
  return {
    lastExportAt: value.lastExportAt, coverage, restoredAt: value.restoredAt,
    sourceExportedAt: value.sourceExportedAt, requiresRemoteRefresh: value.requiresRemoteRefresh,
  };
}

function readPair(database: IDBDatabase, id: string): Promise<{ key: StoredKey; record?: StoredRecord }> {
  return transaction(database, ["keys", "records"], "readonly", (tx, done, abort) => {
    const key = tx.objectStore("keys").get(LOCAL_KEY);
    const record = tx.objectStore("records").get(id);
    afterRequests([key, record], () => done({ key: storedKey(key.result), record: storedRecord(record.result, id) }), abort);
  });
}

async function decodeRecord<T>(key: CryptoKey, record: StoredRecord): Promise<LocalRecord<T> | null> {
  if (!record.envelope) return null;
  const value = await decryptJson<T>(key, record.envelope, { kind: "local", recordId: record.id, revision: record.revision });
  validateLocalRecord({ id: record.id, revision: record.revision, value });
  return { id: record.id, revision: record.revision, value };
}

export async function readRecord<T = unknown>(id: string): Promise<LocalRecord<T> | null> {
  assertRecordId(id);
  return withDatabase(async (database) => {
    await ensureKey(database);
    const { key, record } = await readPair(database, id);
    return record ? decodeRecord<T>(key.key, record) : null;
  });
}

export async function listRecords<T = unknown>(prefix = ""): Promise<LocalRecord<T>[]> {
  if (typeof prefix !== "string" || prefix.length > 200 || !/^[A-Za-z0-9._:/-]*$/.test(prefix)) throw new Error("Invalid record prefix.");
  return withDatabase(async (database) => {
    await ensureKey(database);
    const snapshot = await transaction<{ key: StoredKey; records: StoredRecord[] }>(database, ["keys", "records"], "readonly", (tx, done, abort) => {
      const key = tx.objectStore("keys").get(LOCAL_KEY);
      const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}\uffff`) : undefined;
      const records = tx.objectStore("records").getAll(range, MAX_RECORDS + 1);
      afterRequests([key, records], () => {
        if (records.result.length > MAX_RECORDS) throw new Error("The workspace has too many records.");
        done({ key: storedKey(key.result), records: records.result.map((record: unknown) => storedRecord(record) as StoredRecord) });
      }, abort);
    });
    const records = await Promise.all(snapshot.records.map((record) => decodeRecord<T>(snapshot.key.key, record)));
    return records.filter((record) => record !== null);
  });
}

export async function writeRecord<T>(id: string, value: T, expectedRevision: number | null): Promise<LocalRecord<T>> {
  assertRecordId(id);
  if (expectedRevision !== null) assertRevision(expectedRevision, 1);
  // Snapshot before the first await so caller mutations cannot change the value being committed.
  const copied = JSON.parse(canonicalJson(value)) as T;
  validateLocalRecord({ id, revision: 1, value: copied });
  return withDatabase(async (database) => {
    await ensureKey(database);
    const before = await readPair(database, id);
    if (expectedRevision === null ? Boolean(before.record?.envelope) : !before.record?.envelope || before.record.revision !== expectedRevision) {
      throw new WorkspaceConflictError();
    }
    const revision = (before.record?.revision ?? 0) + 1;
    assertRevision(revision, 1);
    // WebCrypto awaits stay outside IDB transactions, which may auto-commit between tasks.
    const envelope = await encryptJson(before.key.key, copied, { kind: "local", recordId: id, revision });
    await transaction<void>(database, ["keys", "records"], "readwrite", (tx, done, abort) => {
      const records = tx.objectStore("records");
      const key = tx.objectStore("keys").get(LOCAL_KEY);
      const current = records.get(id);
      const count = records.count();
      afterRequests([key, current, count], () => {
        const currentRecord = storedRecord(current.result, id);
        if (
          storedKey(key.result).generation !== before.key.generation ||
          currentRecord?.revision !== before.record?.revision ||
          Boolean(currentRecord?.envelope) !== Boolean(before.record?.envelope)
        ) throw new WorkspaceConflictError();
        if (!currentRecord && count.result >= MAX_RECORDS) throw new Error("The workspace record limit has been reached.");
        records.put({ id, revision, envelope } satisfies StoredRecord);
        done(undefined);
      }, abort);
    });
    return { id, revision, value: copied };
  });
}

export async function deleteRecord(id: string, expectedRevision: number): Promise<void> {
  assertRecordId(id);
  assertRevision(expectedRevision, 1);
  return withDatabase(async (database) => {
    const before = await ensureKey(database);
    await transaction<void>(database, ["keys", "records"], "readwrite", (tx, done, abort) => {
      const key = tx.objectStore("keys").get(LOCAL_KEY);
      const records = tx.objectStore("records");
      const current = records.get(id);
      afterRequests([key, current], () => {
        if (storedKey(key.result).generation !== before.generation) throw new WorkspaceConflictError();
        const record = storedRecord(current.result, id);
        if (!record?.envelope || record.revision !== expectedRevision) throw new WorkspaceConflictError();
        assertRevision(record.revision + 1, 1);
        // Retain only an ID/revision tombstone to prevent stale CAS after deleting and recreating an ID.
        records.put({ id, revision: record.revision + 1, envelope: null } satisfies StoredRecord);
        done(undefined);
      }, abort);
    });
  });
}

export async function clearWorkspace(): Promise<void> {
  return withDatabase((database) => transaction<void>(database, STORES, "readwrite", (tx, done) => {
    for (const store of STORES) tx.objectStore(store).clear();
    done(undefined);
  }));
}

export async function workspaceSupport(): Promise<boolean> {
  try {
    return await withDatabase(async (database) => {
      const key = await ensureKey(database);
      const context = { kind: "local" as const, recordId: "workspace:support-probe", revision: 0 };
      const envelope = await encryptJson(key.key, { supported: true }, context);
      const copy = await transaction<EncryptedEnvelope>(database, ["keys", "metadata"], "readwrite", (tx, done, abort) => {
        const persisted = tx.objectStore("keys").get(LOCAL_KEY);
        afterRequests([persisted], () => {
          if (storedKey(persisted.result).generation !== key.generation) throw new WorkspaceConflictError();
          const metadata = tx.objectStore("metadata");
          metadata.put(envelope, "support-probe");
          const probe = metadata.get("support-probe");
          afterRequests([probe], () => {
            metadata.delete("support-probe");
            done(validateEnvelope(probe.result, context));
          }, abort);
        }, abort);
      });
      return (await decryptJson<{ supported: boolean }>(key.key, copy, context)).supported === true;
    });
  } catch {
    return false;
  }
}

/** Internal: records, key, and recovery coverage are captured in one read transaction. */
export async function captureWorkspace(): Promise<WorkspaceSnapshot> {
  return withDatabase(async (database) => {
    await ensureKey(database);
    const snapshot = await transaction<{
      key: StoredKey; records: StoredRecord[]; metadata?: StoredMetadata; capturedAt: string;
    }>(database, STORES, "readonly", (tx, done, abort) => {
      const key = tx.objectStore("keys").get(LOCAL_KEY);
      const records = tx.objectStore("records").getAll(undefined, MAX_RECORDS + 1);
      const metadata = tx.objectStore("metadata").get(RECOVERY_STATE);
      afterRequests([key, records, metadata], () => {
        if (records.result.length > MAX_RECORDS) throw new Error("The workspace has too many records.");
        done({
          key: storedKey(key.result), records: records.result.map((record: unknown) => storedRecord(record) as StoredRecord),
          metadata: storedMetadata(metadata.result), capturedAt: new Date().toISOString(),
        });
      }, abort);
    });
    const records = await Promise.all(snapshot.records.map((record) => decodeRecord(snapshot.key.key, record)));
    return {
      records: records.filter((record) => record !== null),
      coverage: snapshot.records.flatMap((record) => record.envelope ? [{ id: record.id, revision: record.revision, nonce: record.envelope.nonce }] : []),
      generation: snapshot.key.generation, capturedAt: snapshot.capturedAt,
      recovery: await recoveryState(snapshot.key.key, snapshot.metadata),
    };
  });
}

/** Internal: only the captured revisions/nonces become covered, even if export encryption was slow. */
export async function recordWorkspaceExport(snapshot: WorkspaceSnapshot): Promise<void> {
  return withDatabase(async (database) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = await transaction<{ key: StoredKey; metadata?: StoredMetadata }>(database, ["keys", "metadata"], "readonly", (tx, done, abort) => {
        const key = tx.objectStore("keys").get(LOCAL_KEY);
        const metadata = tx.objectStore("metadata").get(RECOVERY_STATE);
        afterRequests([key, metadata], () => done({ key: storedKey(key.result), metadata: storedMetadata(metadata.result) }), abort);
      });
      if (before.key.generation !== snapshot.generation) throw new WorkspaceConflictError();
      const state = await recoveryState(before.key.key, before.metadata);
      const revision = (before.metadata?.revision ?? 0) + 1;
      const envelope = await encryptJson(before.key.key, {
        ...state, lastExportAt: snapshot.capturedAt, coverage: snapshot.coverage,
      }, { kind: "local", recordId: METADATA_ID, revision });
      const saved = await transaction<boolean>(database, ["keys", "metadata"], "readwrite", (tx, done, abort) => {
        const key = tx.objectStore("keys").get(LOCAL_KEY);
        const metadata = tx.objectStore("metadata");
        const current = metadata.get(RECOVERY_STATE);
        afterRequests([key, current], () => {
          if (storedKey(key.result).generation !== snapshot.generation) throw new WorkspaceConflictError();
          if (storedMetadata(current.result)?.revision !== before.metadata?.revision) return done(false);
          metadata.put({ revision, envelope } satisfies StoredMetadata, RECOVERY_STATE);
          done(true);
        }, abort);
      });
      if (saved) return;
    }
    throw new WorkspaceConflictError();
  });
}

/** Internal: support-check key initialization alone does not make an otherwise empty workspace dirty. */
export async function assertCleanWorkspace(): Promise<void> {
  return withDatabase((database) => transaction<void>(database, ["records", "metadata"], "readonly", (tx, done, abort) => {
    const records = tx.objectStore("records").count();
    const metadata = tx.objectStore("metadata").count();
    afterRequests([records, metadata], () => {
      if (records.result || metadata.result) throw new Error("Recovery requires a clean workspace. Export existing data and explicitly clear this workspace first.");
      done(undefined);
    }, abort);
  }));
}

/** Internal: re-encrypt and atomically install the restore guard, new key, and complete inventory. */
export async function restoreWorkspaceRecords(records: LocalRecord[], exportedAt: string): Promise<void> {
  if (!isTimestamp(exportedAt) || !Array.isArray(records) || records.length > MAX_RECORDS) throw new Error("Invalid recovery snapshot.");
  const ids = new Set<string>();
  const copy = records.map((record) => {
    const checked = validateLocalRecord(record);
    if (ids.has(checked.id)) throw new Error("Duplicate recovery record ID.");
    ids.add(checked.id);
    return JSON.parse(canonicalJson(checked)) as LocalRecord;
  });
  return withDatabase(async (database) => {
    const key = await newLocalKey();
    const encrypted = await Promise.all(copy.map(async (record): Promise<StoredRecord> => ({
      id: record.id, revision: record.revision,
      envelope: await encryptJson(key.key, record.value, { kind: "local", recordId: record.id, revision: record.revision }),
    })));
    const recovery: RecoveryState = {
      lastExportAt: exportedAt,
      coverage: encrypted.map((record) => ({ id: record.id, revision: record.revision, nonce: (record.envelope as EncryptedEnvelope).nonce })),
      restoredAt: new Date().toISOString(), sourceExportedAt: exportedAt, requiresRemoteRefresh: true,
    };
    const metadata: StoredMetadata = {
      revision: 1,
      envelope: await encryptJson(key.key, recovery, { kind: "local", recordId: METADATA_ID, revision: 1 }),
    };
    await transaction<void>(database, STORES, "readwrite", (tx, done, abort) => {
      const recordStore = tx.objectStore("records");
      const metadataStore = tx.objectStore("metadata");
      const currentRecords = recordStore.count();
      const currentMetadata = metadataStore.count();
      afterRequests([currentRecords, currentMetadata], () => {
        if (currentRecords.result || currentMetadata.result) throw new Error("Recovery requires a clean workspace. Existing data was not overwritten.");
        tx.objectStore("keys").put(key, LOCAL_KEY);
        metadataStore.add(metadata, RECOVERY_STATE);
        for (const record of encrypted) recordStore.add(record);
        done(undefined);
      }, abort);
    });
  });
}

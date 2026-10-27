import { decryptJson, encryptJson, encodeBase64Url, type EncryptedEnvelope } from "./crypto";
import {
  decodeBase64Url, hasExactKeys, isTimestamp, MAX_RECORDS, validateEnvelope, validateLocalRecord,
} from "./format";
import {
  assertCleanWorkspace, captureWorkspace, recordWorkspaceExport, restoreWorkspaceRecords,
  type LocalRecord,
} from "./storage";

// Version 1 has one fixed, bounded work factor, not a caller-selected iteration count.
export const RECOVERY_ITERATIONS = 600_000;
export const MAX_RECOVERY_BYTES = 20 * 1024 * 1024;
const CONTEXT = { kind: "recovery" as const, recordId: "splyt-private-workspace", revision: 1 };
const OPEN_ERROR = "Unable to open this recovery file. Check the passphrase and that the file is intact.";

interface RecoveryFile {
  version: 1;
  format: "splyt-private-workspace";
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  envelope: EncryptedEnvelope;
}

function passphraseBytes(passphrase: string): Uint8Array<ArrayBuffer> {
  if (
    typeof passphrase !== "string" || passphrase.length > 1024 ||
    Array.from(passphrase).length < 12 || !/\S/u.test(passphrase)
  ) throw new Error("Use a recovery passphrase of at least 12 characters and no more than 1024 characters.");
  // Do not trim or normalize a passphrase: import must use the exact original characters.
  return new TextEncoder().encode(passphrase);
}

async function recoveryKey(
  passphrase: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const material = await window.crypto.subtle.importKey("raw", passphrase, "PBKDF2", false, ["deriveKey"]);
  return window.crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_ITERATIONS, salt },
    material, { name: "AES-GCM", length: 256 }, false, [usage],
  );
}

function recoveryFile(text: string): RecoveryFile {
  if (
    typeof text !== "string" || text.length > MAX_RECOVERY_BYTES ||
    new TextEncoder().encode(text).byteLength > MAX_RECOVERY_BYTES
  ) throw new Error(OPEN_ERROR);
  const value: unknown = JSON.parse(text);
  if (
    !hasExactKeys(value, ["version", "format", "kdf", "envelope"]) ||
    value.version !== 1 || value.format !== "splyt-private-workspace" ||
    !hasExactKeys(value.kdf, ["name", "hash", "iterations", "salt"]) ||
    value.kdf.name !== "PBKDF2" || value.kdf.hash !== "SHA-256" || value.kdf.iterations !== RECOVERY_ITERATIONS ||
    typeof value.kdf.salt !== "string" || decodeBase64Url(value.kdf.salt).length !== 16
  ) throw new Error(OPEN_ERROR);
  return {
    version: 1, format: "splyt-private-workspace",
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_ITERATIONS, salt: value.kdf.salt },
    envelope: validateEnvelope(value.envelope, CONTEXT),
  };
}

function recoveryPayload(value: unknown): { exportedAt: string; records: LocalRecord[] } {
  if (
    !hasExactKeys(value, ["version", "exportedAt", "records"]) || value.version !== 1 ||
    !isTimestamp(value.exportedAt) || !Array.isArray(value.records) || value.records.length > MAX_RECORDS
  ) throw new Error(OPEN_ERROR);
  const ids = new Set<string>();
  const records = value.records.map((record: unknown) => {
    const checked = validateLocalRecord(record);
    if (ids.has(checked.id)) throw new Error(OPEN_ERROR);
    ids.add(checked.id);
    return checked;
  });
  return { exportedAt: value.exportedAt, records };
}

export async function exportWorkspace(passphrase: string): Promise<string> {
  const bytes = passphraseBytes(passphrase);
  try {
    const snapshot = await captureWorkspace();
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const key = await recoveryKey(bytes, salt, "encrypt");
    const envelope = await encryptJson(key, {
      version: 1, exportedAt: snapshot.capturedAt, records: snapshot.records,
    }, CONTEXT);
    const file: RecoveryFile = {
      version: 1, format: "splyt-private-workspace",
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: RECOVERY_ITERATIONS, salt: encodeBase64Url(salt) },
      envelope,
    };
    const text = JSON.stringify(file);
    if (new TextEncoder().encode(text).byteLength > MAX_RECOVERY_BYTES) {
      throw new Error("This workspace exceeds the 20 MiB recovery file limit. No export was marked complete.");
    }
    await recordWorkspaceExport(snapshot);
    return text;
  } finally {
    bytes.fill(0);
  }
}

export async function importWorkspace(text: string, passphrase: string): Promise<void> {
  let file: RecoveryFile;
  try { file = recoveryFile(text); } catch { throw new Error(OPEN_ERROR); }
  const bytes = passphraseBytes(passphrase);
  try {
    await assertCleanWorkspace();
    let snapshot: { exportedAt: string; records: LocalRecord[] };
    try {
      const key = await recoveryKey(bytes, decodeBase64Url(file.kdf.salt), "decrypt");
      snapshot = recoveryPayload(await decryptJson<unknown>(key, file.envelope, CONTEXT));
    } catch {
      // Wrong passphrases, authentication failures, and malformed authenticated payloads look alike.
      throw new Error(OPEN_ERROR);
    }
    // A second clean-workspace check is inside the final atomic write, closing multi-tab races.
    await restoreWorkspaceRecords(snapshot.records, snapshot.exportedAt);
  } finally {
    bytes.fill(0);
  }
}

export async function recoveryStatus(): Promise<{ lastExportAt: string | null; uncoveredRecords: number }> {
  const snapshot = await captureWorkspace();
  const covered = new Map(snapshot.recovery.coverage.map((entry) => [entry.id, entry]));
  let uncoveredRecords = 0;
  for (const current of snapshot.coverage) {
    const previous = covered.get(current.id);
    if (!previous || previous.revision !== current.revision || previous.nonce !== current.nonce) uncoveredRecords++;
    covered.delete(current.id);
  }
  // Deletions also make the old snapshot stale; exporting again must not resurrect them unnoticed.
  uncoveredRecords += covered.size;
  return { lastExportAt: snapshot.recovery.lastExportAt, uncoveredRecords };
}

export async function recoveryMetadata(): Promise<{
  restoredAt: string | null;
  exportedAt: string | null;
  requiresRemoteRefresh: boolean;
}> {
  const { recovery } = await captureWorkspace();
  // This guard is intentionally not cleared here. The business layer must reconcile restored bills with the relay.
  return {
    restoredAt: recovery.restoredAt, exportedAt: recovery.sourceExportedAt,
    requiresRemoteRefresh: recovery.requiresRemoteRefresh,
  };
}

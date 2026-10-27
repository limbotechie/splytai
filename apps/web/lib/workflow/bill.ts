/**
 * Organiser bill workflow.
 *
 * Each function completes one atomic user-intent step.  Side-effect ordering:
 *   1. validate inputs in memory
 *   2. relay call (if any) — may retry idempotently
 *   3. encrypt + write to IndexedDB
 *
 * Nothing here renders anything.  The callers (future UI) supply relay client
 * and app-URL from environment config.
 */

import { createBillManifest, validateBillManifest } from "../bills/manifest";
import { generateContentKey, randomId } from "../private-workspace/crypto";
import { encryptJson, decryptJson } from "../private-workspace/crypto";
import { readRecord, writeRecord, deleteRecord, listRecords } from "../private-workspace/storage";
import type { LocalRecord } from "../private-workspace/storage";
import { requireWritableBill, recordReconciliation } from "../requests/write-gate";
import { mergeRemoteBill } from "../requests/sync";
import type { RelayClient } from "../requests/relay";
import type { BillManifest, CreateBillManifestInput, LocalBill } from "../bills/types";
import { validateAddress } from "../zcash/address";

// Record ID conventions kept in one place.
export const billRecordId = (billId: string) => `bill:${billId}`;
export const billRecordPrefix = "bill:";

/** Read one bill from local storage, or null if absent. */
export async function readLocalBill(billId: string): Promise<LocalBill | null> {
  const record = await readRecord<LocalBill>(billRecordId(billId));
  if (!record) return null;
  validateBillManifest(record.value.manifest, billId);
  return record.value;
}

/** List all bills stored locally, in no particular order. */
export async function listLocalBills(): Promise<LocalRecord<LocalBill>[]> {
  return listRecords<LocalBill>(billRecordPrefix);
}

export interface CreatedBill {
  billId: string;
  bill: LocalBill;
  localRevision: number;
}

/**
 * Creates a bill manifest, reserves it on the relay, and stores it locally.
 *
 * The edit capability is part of the manifest's content (encrypted inside the
 * local envelope) — it is never stored in plain text and never sent to a
 * participant.
 */
export async function createBill(
  relay: RelayClient,
  input: CreateBillManifestInput & { billId?: string },
  now = new Date().toISOString(),
): Promise<CreatedBill> {
  const billId = input.billId ?? randomId();
  const operationId = randomId();

  // 1. Build and validate the manifest locally before touching the relay.
  const manifest = await createBillManifest({ ...input, billId, now });
  manifest.receiving = await validateAddress(manifest.receiving.address, "testnet");

  // 2. Reserve the bill on the relay.  The relay issues the edit capability.
  const reservation = await relay.createBill({ id: billId, operationId });

  // 3. Generate a content key for encrypting the manifest envelope on the relay.
  const contentKey = await generateContentKey();

  // 4. Encrypt and push the manifest to the relay at revision 1.
  const envelope = await encryptJson(contentKey, manifest, {
    kind: "bill", recordId: billId, revision: 1,
  });
  await relay.updateBill(billId, reservation.editCapability, {
    operationId: randomId(),
    expectedRevision: 0,
    envelope,
  });

  // 5. Build the LocalBill, including the edit capability inside the manifest.
  //    We store a private field the relay never sees.
  const bill: LocalBill = {
    version: 1,
    contentKey,
    revision: 1,
    retainedUntil: reservation.retainedUntil,
    manifest,
  };

  // Actually: editCapability is NOT a manifest field. Store it separately
  // as a local-only sibling record so the manifest remains round-trip clean.
  const billRecord = await writeRecord<LocalBill>(billRecordId(billId), bill, null);
  await writeRecord<{ editCapability: string }>(
    `bill-edit:${billId}`,
    { editCapability: reservation.editCapability },
    null,
  );

  // 6. Record the initial reconciliation receipt so this bill is writable immediately.
  await recordReconciliation({ revision: 1, manifest }, now);

  return { billId, bill: billRecord.value, localRevision: billRecord.revision };
}

/** Read the organiser's edit capability for a bill from local storage. */
export async function readEditCapability(billId: string): Promise<string | null> {
  const record = await readRecord<{ editCapability: string }>(`bill-edit:${billId}`);
  return record?.value.editCapability ?? null;
}

export interface SyncedBill {
  bill: LocalBill;
  localRevision: number;
}

/**
 * Reconciles the local bill with the relay, writes the merged state to IndexedDB,
 * and records a fresh reconciliation receipt.
 *
 * Call this before any write operation so the write gate is satisfied.
 */
export async function syncBill(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  now = new Date().toISOString(),
): Promise<SyncedBill> {
  const local = localBillRecord.value;
  validateBillManifest(local.manifest, local.manifest.billId);
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  const remoteBill = await relay.getBill(billId, editCap);
  const merged = await mergeRemoteBill(local, remoteBill);

  const stored = await writeRecord<LocalBill>(
    billRecordId(billId),
    merged,
    localBillRecord.revision,
  );
  await recordReconciliation({ revision: merged.revision, manifest: merged.manifest }, now);
  return { bill: stored.value, localRevision: stored.revision };
}

/**
 * Saves an updated manifest after a local amendment (e.g. adding a reservation).
 *
 * The caller is responsible for calling `syncBill` first so the write gate
 * is satisfied and the relay revision is fresh.
 */
export async function saveBillManifest(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  nextManifest: BillManifest,
  now = new Date().toISOString(),
): Promise<SyncedBill> {
  const local = localBillRecord.value;
  validateBillManifest(nextManifest, local.manifest.billId);
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  const nextRevision = local.revision + 1;
  const envelope = await encryptJson(local.contentKey, nextManifest, {
    kind: "bill", recordId: billId, revision: nextRevision,
  });
  await relay.updateBill(billId, editCap, {
    operationId: randomId(),
    expectedRevision: local.revision,
    envelope,
  });

  const next: LocalBill = {
    ...local,
    manifest: nextManifest,
    revision: nextRevision,
    retainedUntil: local.retainedUntil,
  };
  const stored = await writeRecord<LocalBill>(
    billRecordId(billId),
    next,
    localBillRecord.revision,
  );
  await recordReconciliation({ revision: nextRevision, manifest: nextManifest }, now);
  return { bill: stored.value, localRevision: stored.revision };
}

/**
 * Archives or un-archives a bill.  Archiving never blocks on unresolved reports
 * because it is not an economic amendment (no amounts change).
 */
import { setArchived } from "../requests/publish";

export async function archiveBill(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  archive: boolean,
  now = new Date().toISOString(),
): Promise<SyncedBill> {
  const local = localBillRecord.value;
  const next = setArchived(local.manifest, archive, now);
  return saveBillManifest(relay, localBillRecord, next, now);
}

/**
 * Deletes the relay record and removes both local records (bill + edit-cap).
 *
 * The caller must have a fresh reconciliation receipt (call `syncBill` first).
 */
export async function deleteBill(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  now = new Date().toISOString(),
): Promise<void> {
  const local = localBillRecord.value;
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  await relay.deleteBill(billId, editCap, {
    operationId: randomId(),
    expectedRevision: local.revision,
  });

  // Remove local records.  Tombstones remain so CAS is safe.
  await deleteRecord(billRecordId(billId), localBillRecord.revision);
  const editRecord = await readRecord<{ editCapability: string }>(`bill-edit:${billId}`);
  if (editRecord) await deleteRecord(`bill-edit:${billId}`, editRecord.revision);
}

/**
 * Clears only the local records without touching the relay.
 *
 * Used when the organiser wants to remove the bill from this device but keep
 * it alive on the relay (e.g. switching to a new device and not yet exporting).
 * The caller is responsible for explaining the data-loss risk.
 */
export async function clearLocalBill(localBillRecord: LocalRecord<LocalBill>): Promise<void> {
  const billId = localBillRecord.value.manifest.billId;
  await deleteRecord(billRecordId(billId), localBillRecord.revision);
  const editRecord = await readRecord<{ editCapability: string }>(`bill-edit:${billId}`);
  if (editRecord) await deleteRecord(`bill-edit:${billId}`, editRecord.revision);
}

/**
 * Re-reads and decrypts a bill's manifest from the relay using a stored content key.
 *
 * Used after `importWorkspace` to verify that the relay copy matches the local one.
 */
export async function verifyBillAgainstRelay(
  relay: RelayClient,
  local: LocalBill,
): Promise<boolean> {
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) return false;
  try {
    const remote = await relay.getBill(billId, editCap);
    if (!remote.envelope) return false;
    const decrypted = await decryptJson<unknown>(local.contentKey, remote.envelope, {
      kind: "bill", recordId: billId, revision: remote.revision,
    });
    validateBillManifest(decrypted, billId);
    return true;
  } catch {
    return false;
  }
}

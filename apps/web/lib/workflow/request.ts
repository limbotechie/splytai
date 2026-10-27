/**
 * Organiser request workflow.
 *
 * The publish pipeline is intentionally sequential and non-retryable after the
 * relay accepts the sealed envelope, because the invite fragment contains the
 * content key and must not be regenerated from a partially committed state.
 *
 * Step order:
 *   1. prepareRequest()     — local, no relay
 *   2. relay.reserveRequest() — relay issues read/report capabilities
 *   3. recordReservation()  — writes capabilities into the manifest
 *   4. sealRequest()        — sign + encrypt the immutable offer
 *   5. relay.publishRequest() — relay commits the sealed envelope
 *   6. markPublished()      — updates the manifest publication timestamp
 *   7. saveBillManifest()   — persists the updated manifest to IndexedDB
 *   8. return invite        — caller may now display the fragment invite URL
 *
 * The invite is never shown between steps 4 and 7.
 */

import { randomId } from "../private-workspace/crypto";
import { readRecord, writeRecord } from "../private-workspace/storage";
import type { LocalRecord } from "../private-workspace/storage";
import {
  prepareRequest, recordReservation, sealRequest,
  markPublished, markRevoked, markCancelled,
  isUnpublished,
} from "../requests/publish";
import { requireWritableBill } from "../requests/write-gate";
import { inviteUrl } from "../requests/invite";
import { reconcileBill } from "../requests/sync";
import { saveBillManifest, readEditCapability } from "./bill";
import type { RelayClient } from "../requests/relay";
import type { LocalBill } from "../bills/types";
import type { InviteSecrets, PreparedRequest, RequestState, SealedRequest } from "../requests/types";
import { validateAddress } from "../zcash/address";

// Record ID conventions for request states kept in one place.
export const requestRecordId = (requestId: string) => `request:${requestId}`;
export const requestRecordPrefix = "request:";

/** Read one organiser or participant request state from local storage. */
export async function readLocalRequest(requestId: string): Promise<LocalRecord<RequestState> | null> {
  return readRecord<RequestState>(requestRecordId(requestId));
}

/** List all request states stored locally. */
export async function listLocalRequests(): Promise<LocalRecord<RequestState>[]> {
  const { listRecords } = await import("../private-workspace/storage");
  return listRecords<RequestState>(requestRecordPrefix);
}

export interface PublishedRequest {
  /** Updated local bill record. */
  bill: LocalBill;
  localBillRevision: number;
  /** The invite secrets to be encoded as a fragment URL and displayed to the participant. */
  invite: InviteSecrets;
  /** Pre-built invite URL (fragment included). Never stored; shown once. */
  inviteUrl: string;
  /** The sealed request for this organiser's own state. */
  state: RequestState;
  localRequestRevision: number;
}

/**
 * Full publish pipeline for one participant request.
 *
 * The invite URL is returned but never written to storage.  The organiser must
 * copy it immediately; it cannot be reconstructed without decrypting the manifest
 * and re-sealing (which is safe to do again if needed, but the participant's URL
 * will differ by nonce).
 */
export async function publishRequest(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  participantId: string,
  appUrl: string,
  options: { replaceRequestId?: string; now?: string } = {},
): Promise<PublishedRequest> {
  const now = options.now ?? new Date().toISOString();
  const local = localBillRecord.value;
  const billId = local.manifest.billId;
  if (local.manifest.receiving.network !== "testnet") throw new Error("Request publication is supported on testnet only.");
  await validateAddress(local.manifest.receiving.address, "testnet");
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  // Gate: must be reconciled within the last 10 minutes.
  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  // 1. Prepare local identifiers.
  const prepared: PreparedRequest = await prepareRequest(local.manifest, participantId, {
    now,
    replaceRequestId: options.replaceRequestId,
    requestId: randomId(),
    obligationId: options.replaceRequestId
      ? local.manifest.requests.find((e) => e.requestId === options.replaceRequestId)?.obligationId
      : randomId(),
  });

  // 2. Reserve capabilities on the relay.
  const reservation = await relay.reserveRequest(billId, editCap, {
    id: prepared.requestId,
    operationId: randomId(),
  });

  // 3. Record the reservation in a clone of the manifest (not yet saved).
  let nextManifest = recordReservation(local.manifest, prepared, {
    requestId: reservation.id,
    readCapability: reservation.readCapability,
    reportCapability: reservation.reportCapability,
  }, now);

  // 4. Seal the immutable request offer.
  const sealed: SealedRequest = await sealRequest(nextManifest, prepared, {
    requestId: reservation.id,
    readCapability: reservation.readCapability,
    reportCapability: reservation.reportCapability,
  });

  // 5. Publish the sealed envelope to the relay.
  await relay.publishRequest(billId, editCap, {
    id: prepared.requestId,
    operationId: randomId(),
    expectedRevision: 0,
    envelope: sealed.envelope,
  });

  // 6. Mark published in the manifest (sets publishedAt).
  nextManifest = markPublished(nextManifest, prepared.requestId, now);

  // 7. Save the updated manifest (relay + IndexedDB).
  const { bill, localRevision: localBillRevision } = await saveBillManifest(
    relay,
    localBillRecord,
    nextManifest,
    now,
  );

  // 8. Persist the organiser's request state.
  const stateValue: RequestState = {
    version: 1,
    requestId: prepared.requestId,
    billId,
    role: "organiser",
    payload: sealed.payload,
    pinnedPublicKey: sealed.invite.publicKey,
    contentKey: sealed.contentKey,
    revision: 1,
    reports: [],
    confirmations: [],
    revoked: false,
    retainedUntil: reservation.retainedUntil,
    lifecycle: "active",
    lastSyncedAt: now,
  };
  const stored = await writeRecord<RequestState>(
    requestRecordId(prepared.requestId),
    stateValue,
    null,
  );

  // 9. Build the invite URL.  Secrets travel only in the fragment.
  const url = inviteUrl(appUrl, prepared.requestId, sealed.invite);

  return {
    bill,
    localBillRevision,
    invite: sealed.invite,
    inviteUrl: url,
    state: stored.value,
    localRequestRevision: stored.revision,
  };
}

export interface RevokedRequest {
  bill: LocalBill;
  localBillRevision: number;
}

/**
 * Revokes a published request on the relay and marks it revoked in the manifest.
 *
 * Does not delete the request state from local storage so the organiser can
 * still view the history.
 */
export async function revokeRequest(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  localRequestRecord: LocalRecord<RequestState>,
  now = new Date().toISOString(),
): Promise<RevokedRequest> {
  const local = localBillRecord.value;
  const billId = local.manifest.billId;
  const requestId = localRequestRecord.value.requestId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  const entry = local.manifest.requests.find((e) => e.requestId === requestId);
  if (!entry) throw new Error("This request is not in the bill manifest.");
  if (entry.revokedAt) throw new Error("This request is already revoked.");

  // Relay revocation.
  await relay.revokeRequest(requestId, editCap, {
    operationId: randomId(),
    expectedRevision: localRequestRecord.value.revision,
  });

  // Update manifest.
  const nextManifest = markRevoked(local.manifest, requestId, now);
  const { bill, localRevision: localBillRevision } = await saveBillManifest(
    relay,
    localBillRecord,
    nextManifest,
    now,
  );

  // Mark revoked in local request state.
  const nextState: RequestState = { ...localRequestRecord.value, revoked: true, lifecycle: "revoked" };
  await writeRecord<RequestState>(requestRecordId(requestId), nextState, localRequestRecord.revision);

  return { bill, localBillRevision };
}

export const revokePublishedRequest = revokeRequest;

/**
 * Cancels a reserved-but-unpublished request.
 *
 * Because the request was never published the relay has no envelope to revoke;
 * the relay record simply becomes unreachable once the manifest no longer
 * references it as a live request.  The manifest is updated to mark the entry
 * cancelled.
 */
export async function cancelReservedRequest(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  requestId: string,
  now = new Date().toISOString(),
): Promise<{ bill: LocalBill; localBillRevision: number }> {
  const local = localBillRecord.value;
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  const entry = local.manifest.requests.find((e) => e.requestId === requestId);
  if (!entry) throw new Error("This request is not in the bill manifest.");
  if (!isUnpublished(entry)) throw new Error("Use revokeRequest for a published request.");

  const nextManifest = markCancelled(local.manifest, requestId, now);
  const saved = await saveBillManifest(relay, localBillRecord, nextManifest, now);
  return { bill: saved.bill, localBillRevision: saved.localRevision };
}

export interface SyncedRequests {
  bill: LocalBill;
  localBillRevision: number;
  requests: RequestState[];
  missingRequestIds: string[];
}

/**
 * Syncs the bill manifest and all its published request states from the relay.
 *
 * Existing local states are passed in and merged; the caller should retrieve them
 * with `listLocalRequests()` filtered to this bill before calling.
 */
export async function syncBillRequests(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  existingStates: RequestState[] = [],
  now = new Date().toISOString(),
): Promise<SyncedRequests> {
  const local = localBillRecord.value;
  const billId = local.manifest.billId;
  const editCap = await readEditCapability(billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  const remoteBill = await relay.getBill(billId, editCap);
  const { bill, requests, missingRequestIds } = await reconcileBill(local, remoteBill, existingStates, now);

  // Persist the updated bill.
  const billStored = await writeRecord<LocalBill>(
    `bill:${billId}`,
    bill,
    localBillRecord.revision,
  );

  // Persist each request state.
  for (const state of requests) {
    const existing = await readRecord<RequestState>(requestRecordId(state.requestId));
    await writeRecord<RequestState>(
      requestRecordId(state.requestId),
      state,
      existing ? existing.revision : null,
    );
  }

  const { recordReconciliation } = await import("../requests/write-gate");
  await recordReconciliation({ revision: bill.revision, manifest: bill.manifest }, now);

  return {
    bill: billStored.value,
    localBillRevision: billStored.revision,
    requests,
    missingRequestIds,
  };
}

/**
 * Posts a confirmation for one request and persists the updated state locally.
 */
export async function confirmPayment(
  relay: RelayClient,
  localBillRecord: LocalRecord<LocalBill>,
  localRequestRecord: LocalRecord<RequestState>,
  input: {
    receivedTotalZatoshis: string;
    outcome: import("../requests/types").ConfirmationPayload["outcome"];
    note?: string | null;
    correctionReason?: string | null;
    previousConfirmationId?: string | null;
    now?: string;
  },
): Promise<{ state: RequestState; localRevision: number }> {
  const local = localBillRecord.value;
  const state = localRequestRecord.value;
  if (state.role !== "organiser") throw new Error("Only the organiser can confirm payments.");
  const now = input.now ?? new Date().toISOString();
  await requireWritableBill({ revision: local.revision, manifest: local.manifest }, now);

  const editCap = await readEditCapability(local.manifest.billId);
  if (!editCap) throw new Error("The edit capability for this bill is not stored in this browser.");

  const { buildConfirmationUpdate, applyLocalUpdate } = await import("../requests/sync");
  const signingKey = local.manifest.signing.privateKey;
  const update = await buildConfirmationUpdate(state, signingKey, input);

  await relay.putConfirmation(state.requestId, editCap, {
    operationId: update.operationId,
    expectedRevision: update.expectedRevision,
    envelope: update.envelope,
  });

  const nextState = await applyLocalUpdate(state, update, now);
  const stored = await writeRecord<RequestState>(
    requestRecordId(state.requestId),
    nextState,
    localRequestRecord.revision,
  );
  return { state: stored.value, localRevision: stored.revision };
}

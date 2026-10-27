/**
 * Participant workflow.
 *
 * Covers the participant lifecycle:
 *   1. Capture invitation fragment from URL or string, parse and validate secrets,
 *      clear the fragment from browser URL/history so secrets don't leak.
 *   2. Read request from relay using the read capability and decrypt with content key.
 *   3. Generate ZIP 321 payment URI for wallet handoff.
 *   4. Submit payment report to relay using the report capability and apply locally.
 *   5. Synchronise latest confirmations/reports from the relay.
 */

import { parseInviteFragment, clearInviteFragmentFromLocation } from "../requests/invite";
import { decryptRequestEnvelope, mergeRequestUpdates, buildReportUpdate, applyLocalUpdate } from "../requests/sync";
import { readRecord, writeRecord, deleteRecord, listRecords } from "../private-workspace/storage";
import type { LocalRecord } from "../private-workspace/storage";
import { paymentUri } from "../zcash/uri";
import { validateAddress } from "../zcash/address";
import { integer, MAX_ZATOSHIS } from "../bills/money";
import type { RelayClient } from "../requests/relay";
import type { InviteSecrets, ImmutableRequestPayload, RequestState } from "../requests/types";
import { requestRecordId } from "./request";

export const participantInviteRecordId = (requestId: string) => `participant-invite:${requestId}`;
export const participantInvitePrefix = "participant-invite:";

/**
 * Parses invite secrets from a full URL, hash fragment, or query string.
 * Strips the fragment from browser history immediately if in the browser.
 * Persists the invite secrets in IndexedDB.
 */
export async function captureAndStoreInvite(rawUrlOrFragment: string): Promise<InviteSecrets> {
  let fragment = rawUrlOrFragment.trim();
  if (fragment.includes("#")) {
    fragment = fragment.slice(fragment.indexOf("#"));
  }
  const invite = parseInviteFragment(fragment);

  // Clear from browser history if running in browser
  clearInviteFragmentFromLocation();

  // Store in local workspace
  const recordId = participantInviteRecordId(invite.requestId);
  const existing = await readRecord<InviteSecrets>(recordId);
  await writeRecord<InviteSecrets>(recordId, invite, existing ? existing.revision : null);

  return invite;
}

/** Reads stored participant invitation secrets by requestId. */
export async function readParticipantInvite(requestId: string): Promise<InviteSecrets | null> {
  const record = await readRecord<InviteSecrets>(participantInviteRecordId(requestId));
  return record ? record.value : null;
}

/** Lists all participant invitations stored locally. */
export async function listParticipantInvites(): Promise<LocalRecord<InviteSecrets>[]> {
  return listRecords<InviteSecrets>(participantInvitePrefix);
}

/**
 * Opens a request from the relay using the participant's invite secrets,
 * verifies the signature with the pinned public key, decrypts the payload,
 * merges any existing reports/confirmations, and saves the RequestState locally.
 */
export async function openParticipantRequest(
  relay: RelayClient,
  invite: InviteSecrets,
  now = new Date().toISOString(),
): Promise<RequestState> {
  const remote = await relay.getRequest(invite.requestId, invite.readCapability);
  if (!remote.envelope) {
    throw new Error("The relay request is missing its encrypted envelope.");
  }

  const signed = await decryptRequestEnvelope(remote.envelope, invite.contentKey, invite.publicKey, {
    requestId: invite.requestId,
  });
  await validateAddress(signed.payload.address, "testnet");

  const existingState = await readRecord<RequestState>(requestRecordId(invite.requestId));
  if (existingState && existingState.value.role !== "participant") {
    throw new Error("This browser holds the organiser's request. Open the participant link in a separate browser profile.");
  }

  const state: RequestState = existingState?.value ?? {
    version: 1,
    requestId: invite.requestId,
    billId: null,
    role: "participant",
    payload: signed,
    pinnedPublicKey: invite.publicKey,
    contentKey: invite.contentKey,
    revision: remote.revision,
    reports: [],
    confirmations: [],
    revoked: remote.revoked,
    retainedUntil: remote.retainedUntil,
    lifecycle: remote.revoked ? "revoked" : Date.parse(signed.payload.expiresAt) <= Date.parse(now) ? "expired" : "active",
    lastSyncedAt: now,
  };

  const merged = await mergeRequestUpdates(state, remote, now);

  await writeRecord<RequestState>(
    requestRecordId(invite.requestId),
    merged,
    existingState ? existingState.revision : null,
  );

  // Also ensure invite is saved
  const existingInvite = await readRecord<InviteSecrets>(participantInviteRecordId(invite.requestId));
  await writeRecord<InviteSecrets>(
    participantInviteRecordId(invite.requestId),
    invite,
    existingInvite ? existingInvite.revision : null,
  );

  return merged;
}

/**
 * Synchronises an already opened participant request from the relay.
 */
export async function syncParticipantRequest(
  relay: RelayClient,
  requestId: string,
  now = new Date().toISOString(),
): Promise<RequestState> {
  const invite = await readParticipantInvite(requestId);
  if (!invite) {
    throw new Error("Participant invitation not found for this request.");
  }

  const localRecord = await readRecord<RequestState>(requestRecordId(requestId));
  if (!localRecord) {
    return openParticipantRequest(relay, invite, now);
  }
  if (localRecord.value.role !== "participant") throw new Error("Open this participant request in a separate browser profile.");

  const remote = await relay.getRequest(requestId, invite.readCapability);
  const updated = await mergeRequestUpdates(localRecord.value, remote, now);
  await validateAddress(updated.payload.payload.address, "testnet");

  await writeRecord<RequestState>(requestRecordId(requestId), updated, localRecord.revision);
  return updated;
}

/**
 * Submits a payment report for a participant request.
 */
export async function submitPaymentReport(
  relay: RelayClient,
  requestId: string,
  input: {
    claimedZatoshis: string;
    reference?: string | null;
    note?: string | null;
    now?: string;
  },
): Promise<RequestState> {
  const invite = await readParticipantInvite(requestId);
  if (!invite) {
    throw new Error("Participant invitation not found for this request.");
  }

  const localRecord = await readRecord<RequestState>(requestRecordId(requestId));
  if (!localRecord) {
    throw new Error("Request state not found for this request.");
  }
  if (localRecord.value.role !== "participant") {
    throw new Error("Only a participant can report a payment for this request.");
  }

  const update = await buildReportUpdate(localRecord.value, input);

  await relay.reportPayment(requestId, invite.reportCapability, {
    operationId: update.operationId,
    expectedRevision: update.expectedRevision,
    envelope: update.envelope,
  });

  const now = input.now ?? new Date().toISOString();
  const nextState = await applyLocalUpdate(localRecord.value, update, now);

  const stored = await writeRecord<RequestState>(
    requestRecordId(requestId),
    nextState,
    localRecord.revision,
  );
  return stored.value;
}

/**
 * Generates the ZIP 321 payment URI for wallet handoff.
 */
export async function participantPaymentUri(payload: ImmutableRequestPayload, amountZatoshis = payload.amountZatoshis): Promise<string> {
  if (payload.network !== "testnet") throw new Error("Wallet handoff is supported on testnet only.");
  const amount = integer(amountZatoshis, MAX_ZATOSHIS);
  if (amount > integer(payload.amountZatoshis, MAX_ZATOSHIS)) throw new Error("The handoff amount cannot exceed the published request.");
  const receiving = await validateAddress(payload.address, "testnet");
  return paymentUri(receiving, amount.toString(), payload.reference);
}

/**
 * Deletes local participant records for a request.
 */
export async function clearParticipantRequest(requestId: string): Promise<void> {
  const stateRecord = await readRecord<RequestState>(requestRecordId(requestId));
  if (stateRecord) {
    await deleteRecord(requestRecordId(requestId), stateRecord.revision);
  }
  const inviteRecord = await readRecord<InviteSecrets>(participantInviteRecordId(requestId));
  if (inviteRecord) {
    await deleteRecord(participantInviteRecordId(requestId), inviteRecord.revision);
  }
}

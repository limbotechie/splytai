import { isUuid, validateBillManifest } from "../bills/manifest";
import { canonicalJson, decodeBase64Url, isTimestamp } from "../private-workspace/format";
import type { BillManifest, LocalBill, RequestInventoryEntry } from "../bills/types";
import {
  decryptJson, encryptJson, randomId, signJson, verifySigned,
} from "../private-workspace/crypto";
import type { EncryptedEnvelope, SignedJson } from "../private-workspace/crypto";
import type { RelayBill, RelayRequest, RelayUpdate } from "./relay";
import {
  buildConfirmationPayload, buildPaymentReportPayload, publicKeyFromRaw, rawPublicKey,
  trackingOf, validateConfirmationPayload, validatePaymentReportPayload, validateRequestPayload,
} from "./payload";
import type {
  ConfirmationPayload, ConfirmationRecord, ImmutableRequestPayload, InviteSecrets,
  PaymentReportPayload, ReportRecord, RequestState,
} from "./types";
import type { TrackingState } from "../bills/types";

function clone<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function key(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value) || decodeBase64Url(value).length !== 32) {
    throw new Error("The record content key is invalid.");
  }
  return value;
}

function sameEnvelope(left: EncryptedEnvelope, right: EncryptedEnvelope): boolean {
  return left.kind === right.kind && left.recordId === right.recordId && left.revision === right.revision &&
    left.nonce === right.nonce && left.ciphertext === right.ciphertext;
}

/** Verifies a signed, encrypted request before the participant or organiser stores it. */
export async function openRequestPayload(
  signedValue: unknown,
  pinnedPublicKey: string,
  expected?: { requestId?: string; obligationId?: string; reference?: string; amountZatoshis?: string; address?: string; network?: "testnet" | "mainnet" },
): Promise<ImmutableRequestPayload> {
  if (!signedValue || typeof signedValue !== "object") throw new Error("The request is not signed.");
  const verified = await verifySigned<unknown>(publicKeyFromRaw(pinnedPublicKey), signedValue as SignedJson<unknown>);
  return validateRequestPayload(verified, expected);
}

export async function decryptRequestEnvelope(
  envelope: EncryptedEnvelope,
  contentKey: string,
  pinnedPublicKey: string,
  expected: { requestId: string; obligationId?: string; reference?: string; amountZatoshis?: string; address?: string; network?: "testnet" | "mainnet" },
): Promise<SignedJson<ImmutableRequestPayload>> {
  const signed = await decryptJson<unknown>(key(contentKey), envelope, {
    kind: "request", recordId: expected.requestId, revision: 1,
  });
  const payload = await openRequestPayload(signed, pinnedPublicKey, expected);
  return { payload, signature: (signed as SignedJson<unknown>).signature };
}

function newState(input: {
  payload: SignedJson<ImmutableRequestPayload>;
  pinnedPublicKey: string;
  contentKey: string;
  billId: string | null;
  role: "organiser" | "participant";
  revision: number;
  revoked: boolean;
  retainedUntil: string;
  now: string;
}): RequestState {
  return {
    version: 1,
    requestId: input.payload.payload.requestId,
    billId: input.billId,
    role: input.role,
    payload: input.payload,
    pinnedPublicKey: input.pinnedPublicKey,
    contentKey: input.contentKey,
    revision: input.revision,
    reports: [],
    confirmations: [],
    revoked: input.revoked,
    retainedUntil: input.retainedUntil,
    lifecycle: input.revoked ? "revoked" : Date.parse(input.payload.payload.expiresAt) <= Date.parse(input.now) ? "expired" : "active",
    lastSyncedAt: input.now,
  };
}

/**
 * Appends only authenticated remote updates. A duplicate record ID must carry the
 * exact same ciphertext; a conflicting duplicate is rejected rather than merged.
 */
export async function mergeRequestUpdates(
  current: RequestState,
  remote: RelayRequest,
  now = new Date().toISOString(),
): Promise<RequestState> {
  if (!isTimestamp(now)) throw new Error("The sync time is invalid.");
  if (remote.id !== current.requestId) throw new Error("The relay request does not match this record.");
  if (remote.revision < current.revision) return clone(current);
  if (current.reports.some((report) => !remote.reports.some((entry) => entry.id === report.id)) ||
    current.confirmations.some((confirmation) => !remote.confirmations.some((entry) => entry.id === confirmation.id))) {
    throw new Error("The relay omitted previously recorded payment history. Existing local records were preserved.");
  }
  const next = clone(current);
  const reports = new Map(next.reports.map((report) => [report.id, report]));
  const confirmations = new Map(next.confirmations.map((confirmation) => [confirmation.id, confirmation]));

  const readUpdate = async (update: RelayUpdate, kind: "report" | "confirmation"): Promise<unknown> => {
    if (update.envelope.kind !== kind || update.envelope.recordId !== update.id) {
      throw new Error("The relay returned an update with the wrong type.");
    }
    if (update.envelope.revision > remote.revision) throw new Error("The relay returned an update newer than its own request.");
    if (!isTimestamp(update.createdAt)) throw new Error("The relay returned an invalid update time.");
    return decryptJson<unknown>(current.contentKey, update.envelope, {
      kind, recordId: update.id, revision: update.envelope.revision,
    });
  };

  for (const update of remote.reports) {
    const existing = reports.get(update.id);
    if (existing) {
      if (!sameEnvelope(existing.envelope, update.envelope)) throw new Error("A payment report was replaced with different content.");
      continue;
    }
    const payload = validatePaymentReportPayload(await readUpdate(update, "report"), {
      requestId: current.requestId, obligationId: current.payload.payload.obligationId,
    });
    const record: ReportRecord = { id: update.id, envelope: update.envelope, payload, reportedAt: payload.reportedAt };
    reports.set(update.id, record);
    next.reports.push(record);
  }
  for (const update of remote.confirmations) {
    const existing = confirmations.get(update.id);
    if (existing) {
      if (!sameEnvelope(existing.envelope, update.envelope)) throw new Error("A confirmation was replaced with different content.");
      continue;
    }
    const decrypted = await readUpdate(update, "confirmation");
    const verified = await verifySigned<unknown>(publicKeyFromRaw(current.pinnedPublicKey), decrypted as SignedJson<unknown>);
    const payload = validateConfirmationPayload(verified, {
      requestId: current.requestId,
      obligationId: current.payload.payload.obligationId,
      requestedZatoshis: current.payload.payload.amountZatoshis,
    });
    const record: ConfirmationRecord = { id: update.id, envelope: update.envelope, payload, confirmedAt: payload.confirmedAt };
    confirmations.set(update.id, record);
    next.confirmations.push(record);
  }
  if (next.reports.length > 48 || next.confirmations.length > 64) throw new Error("This request has too much history to reconcile safely.");
  next.reports.sort((left, right) => left.reportedAt === right.reportedAt ? (left.id < right.id ? -1 : 1) : left.reportedAt < right.reportedAt ? -1 : 1);
  next.confirmations.sort((left, right) => left.confirmedAt === right.confirmedAt ? (left.id < right.id ? -1 : 1) : left.confirmedAt < right.confirmedAt ? -1 : 1);
  next.revision = remote.revision;
  next.revoked = remote.revoked;
  next.retainedUntil = remote.retainedUntil;
  next.lastSyncedAt = now;
  next.lifecycle = remote.revoked ? "revoked"
    : next.lifecycle === "cancelled" ? "cancelled"
      : Date.parse(next.payload.payload.expiresAt) <= Date.parse(now) ? "expired" : "active";
  return next;
}

/** Participant entry point: decrypt the relay envelope, verify the pinned signature, then merge. */
export async function openParticipantRequest(invite: InviteSecrets, remote: RelayRequest, now = new Date().toISOString()): Promise<RequestState> {
  if (!remote.envelope) throw new Error("This request is not published yet.");
  const signedValue = await decryptJson<unknown>(invite.contentKey, remote.envelope, {
    kind: "request", recordId: invite.requestId, revision: 1,
  });
  const payload = await openRequestPayload(signedValue, invite.publicKey, { requestId: invite.requestId });
  const signature = (signedValue as SignedJson<unknown>).signature;
  if (typeof signature !== "string") throw new Error("The request is not signed.");
  const state = newState({
    payload: { payload, signature }, pinnedPublicKey: invite.publicKey, contentKey: invite.contentKey, billId: null,
    role: "participant", revision: remote.revision, revoked: remote.revoked,
    retainedUntil: remote.retainedUntil, now,
  });
  return mergeRequestUpdates(state, remote, now);
}

/** Merges the organiser's inventory without discarding local reservations or newer publication times. */
function mergeInventory(remote: BillManifest, local: BillManifest): RequestInventoryEntry[] {
  const merged = new Map<string, RequestInventoryEntry>();
  for (const entry of remote.requests) merged.set(entry.requestId, entry);
  for (const entry of local.requests) {
    const other = merged.get(entry.requestId);
    if (!other) { merged.set(entry.requestId, entry); continue; }
    if (canonicalJson(other) === canonicalJson(entry)) continue;
    if (!other.publishedAt && entry.publishedAt) { merged.set(entry.requestId, entry); continue; }
    if (other.publishedAt && !entry.publishedAt) continue;
    throw new Error("The bill was edited in another browser. Review both request inventories before continuing.");
  }
  return [...merged.values()];
}

/**
 * Reconciles an organiser's local bill with the relay. A lower remote revision is
 * never allowed to overwrite local work; an equal revision must decrypt to the same
 * manifest, which detects substitution or rollback at the same revision.
 */
export async function mergeRemoteBill(local: LocalBill, remote: RelayBill): Promise<LocalBill> {
  if (remote.id !== local.manifest.billId) throw new Error("The relay returned another bill.");
  validateBillManifest(local.manifest, local.manifest.billId);
  if (!Number.isSafeInteger(local.revision) || local.revision < 0) throw new Error("The local bill revision is invalid.");
  if (remote.revision < local.revision) return clone(local);
  if (remote.revision === local.revision) {
    if (remote.revision === 0) return clone(local);
    if (!remote.envelope) throw new Error("The relay bill is missing its encrypted manifest.");
    const decrypted = await decryptJson<unknown>(local.contentKey, remote.envelope, {
      kind: "bill", recordId: local.manifest.billId, revision: remote.revision,
    });
    const manifest = validateBillManifest(decrypted, local.manifest.billId);
    if (canonicalJson(manifest) !== canonicalJson(local.manifest)) {
      throw new Error("The relay bill differs from this browser at the same revision. Export before replacing anything.");
    }
    return { ...clone(local), retainedUntil: remote.retainedUntil };
  }
  if (!remote.envelope) throw new Error("The relay bill is missing its encrypted manifest.");
  const decrypted = await decryptJson<unknown>(local.contentKey, remote.envelope, {
    kind: "bill", recordId: local.manifest.billId, revision: remote.revision,
  });
  const remoteManifest = validateBillManifest(decrypted, local.manifest.billId);
  const manifest: BillManifest = clone(remoteManifest);
  manifest.requests = mergeInventory(remoteManifest, local.manifest);
  manifest.updatedAt = remoteManifest.updatedAt > local.manifest.updatedAt ? remoteManifest.updatedAt : local.manifest.updatedAt;
  return {
    version: 1,
    contentKey: local.contentKey,
    revision: remote.revision,
    retainedUntil: remote.retainedUntil,
    manifest: validateBillManifest(manifest, local.manifest.billId),
  };
}

/**
 * Reconciles every published request that the relay still retains. Requests that
 * were deleted by retention are reported separately so the UI can mark them
 * unavailable without pretending they were paid.
 */
export async function reconcileBill(local: LocalBill, remote: RelayBill, existing: RequestState[] = [], now = new Date().toISOString()): Promise<{
  bill: LocalBill;
  requests: RequestState[];
  missingRequestIds: string[];
}> {
  const bill = await mergeRemoteBill(local, remote);
  if (!isTimestamp(now)) throw new Error("The sync time is invalid.");
  const pinned = rawPublicKey(bill.manifest.signing.publicKey);
  const remoteById = new Map(remote.requests.map((request) => [request.id, request]));
  const existingById = new Map(existing.map((request) => [request.requestId, request]));
  const requests: RequestState[] = [];
  const missingRequestIds: string[] = [];
  for (const entry of bill.manifest.requests) {
    if (!entry.publishedAt) continue;
    const remoteRequest = remoteById.get(entry.requestId);
    if (!remoteRequest || !remoteRequest.envelope) {
      missingRequestIds.push(entry.requestId);
      continue;
    }
    const signed = await decryptRequestEnvelope(remoteRequest.envelope, entry.contentKey, pinned, {
      requestId: entry.requestId,
      obligationId: entry.obligationId,
      reference: entry.reference,
      amountZatoshis: entry.amountZatoshis,
      address: entry.address,
      network: entry.network,
    });
    const previous = existingById.get(entry.requestId);
    if (previous) {
      if (previous.role !== "organiser" || previous.billId !== bill.manifest.billId) {
        throw new Error("A participant copy of this request is stored in this browser. Open it from its invitation instead.");
      }
      if (previous.contentKey !== entry.contentKey) {
        throw new Error("A stored request uses a different content key from the bill manifest.");
      }
      if (canonicalJson(previous.payload) !== canonicalJson(signed)) {
        throw new Error("A stored request does not match the relay. Export the workspace before replacing it.");
      }
    }
    const state = previous ?? newState({
      payload: signed, pinnedPublicKey: pinned, contentKey: entry.contentKey, billId: bill.manifest.billId,
      role: "organiser", revision: remoteRequest.revision, revoked: remoteRequest.revoked,
      retainedUntil: remoteRequest.retainedUntil, now,
    });
    requests.push(await mergeRequestUpdates(state, remoteRequest, now));
  }
  const unknown = remote.requests.filter((request) => !bill.manifest.requests.some((entry) => entry.requestId === request.id));
  if (unknown.length) throw new Error("The relay has requests that are missing from the bill manifest. Refresh the manifest before writing.");
  return { bill, requests, missingRequestIds };
}

export interface EncryptedUpdate {
  operationId: string;
  updateId: string;
  expectedRevision: number;
  envelope: EncryptedEnvelope;
}

export async function buildReportUpdate(state: RequestState, input: {
  claimedZatoshis: string; reference?: string | null; note?: string | null; now?: string;
}): Promise<EncryptedUpdate & { payload: PaymentReportPayload }> {
  if (state.role !== "participant") throw new Error("Only a participant can report a payment for this request.");
  const now = input.now ?? new Date().toISOString();
  const payload = buildPaymentReportPayload({
    version: 1,
    requestId: state.requestId,
    obligationId: state.payload.payload.obligationId,
    claimedZatoshis: input.claimedZatoshis,
    reportedAt: now,
    reference: input.reference ?? null,
    note: input.note ?? null,
  });
  const updateId = randomId();
  const envelope = await encryptJson(state.contentKey, payload, {
    kind: "report", recordId: updateId, revision: state.revision + 1,
  });
  return { operationId: randomId(), updateId, expectedRevision: state.revision, envelope, payload };
}

export async function buildConfirmationUpdate(state: RequestState, signingKey: JsonWebKey, input: {
  receivedTotalZatoshis: string;
  outcome: ConfirmationPayload["outcome"];
  note?: string | null;
  correctionReason?: string | null;
  previousConfirmationId?: string | null;
  now?: string;
}): Promise<EncryptedUpdate & { payload: ConfirmationPayload }> {
  if (state.role !== "organiser") throw new Error("Only the organiser can confirm this request.");
  const now = input.now ?? new Date().toISOString();
  const payload = buildConfirmationPayload({
    version: 1,
    requestId: state.requestId,
    obligationId: state.payload.payload.obligationId,
    receivedTotalZatoshis: input.receivedTotalZatoshis,
    outcome: input.outcome,
    confirmedAt: now,
    note: input.note ?? null,
    correctionReason: input.correctionReason ?? null,
    previousConfirmationId: input.previousConfirmationId ?? null,
  }, state.payload.payload.amountZatoshis);
  if (input.outcome === "correction" && !state.confirmations.some((record) => record.id === input.previousConfirmationId)) {
    throw new Error("A correction must reference a confirmation stored for this request.");
  }
  const updateId = randomId();
  const signed = await signJson(signingKey, payload);
  const envelope = await encryptJson(state.contentKey, signed, {
    kind: "confirmation", recordId: updateId, revision: state.revision + 1,
  });
  return { operationId: randomId(), updateId, expectedRevision: state.revision, envelope, payload };
}

/**
 * Applies a locally created update after the relay accepted it. The update must
 * decrypt to exactly the payload the caller built, so a stored record can never
 * drift from the ciphertext the relay holds.
 */
export async function applyLocalUpdate(
  state: RequestState,
  update: EncryptedUpdate & { payload: PaymentReportPayload | ConfirmationPayload },
  now = new Date().toISOString(),
): Promise<RequestState> {
  if (!isTimestamp(now)) throw new Error("The sync time is invalid.");
  if (!isUuid(update.updateId) || !isUuid(update.operationId)) throw new Error("The update identifier is invalid.");
  if (!Number.isSafeInteger(update.expectedRevision) || update.expectedRevision !== state.revision) {
    throw new Error("This request changed in another tab. Reload it before adding an update.");
  }
  const next = clone(state);
  if (next.reports.some((record) => record.id === update.updateId) || next.confirmations.some((record) => record.id === update.updateId)) {
    throw new Error("This update is already present.");
  }
  if (update.payload.requestId !== next.requestId || update.payload.obligationId !== next.payload.payload.obligationId) {
    throw new Error("This update belongs to another request.");
  }
  const expectedKind = "claimedZatoshis" in update.payload ? "report" : "confirmation";
  if (update.envelope.kind !== expectedKind) throw new Error("The update envelope has the wrong type.");
  if (update.envelope.recordId !== update.updateId) throw new Error("The update envelope has the wrong record identifier.");
  if (update.envelope.revision !== state.revision + 1) throw new Error("The update envelope has the wrong revision.");
  const decrypted = await decryptJson<unknown>(state.contentKey, update.envelope, {
    kind: expectedKind, recordId: update.updateId, revision: update.envelope.revision,
  });
  if ("claimedZatoshis" in update.payload) {
    const payload = validatePaymentReportPayload(decrypted, {
      requestId: next.requestId, obligationId: next.payload.payload.obligationId,
    });
    if (canonicalJson(payload) !== canonicalJson(update.payload)) {
      throw new Error("The payment report does not match its encrypted record.");
    }
    next.reports.push({ id: update.updateId, envelope: update.envelope, payload, reportedAt: payload.reportedAt });
  } else {
    const verified = await verifySigned<unknown>(publicKeyFromRaw(next.pinnedPublicKey), decrypted as SignedJson<unknown>);
    const payload = validateConfirmationPayload(verified, {
      requestId: next.requestId,
      obligationId: next.payload.payload.obligationId,
      requestedZatoshis: next.payload.payload.amountZatoshis,
    });
    if (canonicalJson(payload) !== canonicalJson(update.payload)) {
      throw new Error("The confirmation does not match its encrypted record.");
    }
    next.confirmations.push({ id: update.updateId, envelope: update.envelope, payload, confirmedAt: payload.confirmedAt });
  }
  next.revision = state.revision + 1;
  next.lastSyncedAt = now;
  return next;
}

export function tracking(state: RequestState): TrackingState {
  return trackingOf(state);
}

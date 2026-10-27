import { assertPayableParticipant, isUuid, validateBillManifest } from "../bills/manifest";
import { MAX_ZATOSHIS, integer } from "../bills/money";
import { canonicalJson, decodeBase64Url, hasExactKeys, isTimestamp } from "../private-workspace/format";
import { createReference } from "../zcash/uri";
import { generateContentKey, randomId } from "../private-workspace/crypto";
import type { BillManifest, RequestInventoryEntry } from "../bills/types";
import { rawPublicKey, validateRequestPayload, buildRequestPayload } from "./payload";
import type {
  InviteSecrets, PreparedRequest, RequestReceiptDisclosure, RequestReservation, SealedRequest,
} from "./types";

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const DAY = 24 * 60 * 60 * 1000;

function snapshot<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

function assertActive(manifest: BillManifest): void {
  if (manifest.status !== "active") throw new Error("Archived bills cannot publish requests. Restore the bill first.");
}

function assertCapability(value: unknown, label: string): string {
  if (typeof value !== "string" || !CAPABILITY.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

function disclosure(manifest: BillManifest, allocation: ReturnType<typeof assertPayableParticipant>): RequestReceiptDisclosure {
  const include = manifest.includeDetails;
  const items = include ? manifest.receipt.items.map((item) => ({ label: item.label, amountMinor: item.amountMinor })) : null;
  const itemsTotal = include ? manifest.receipt.items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n) : null;
  return {
    title: manifest.receipt.title,
    currency: manifest.receipt.currency,
    scale: manifest.receipt.scale,
    shareMinor: allocation.shareMinor,
    subtotalMinor: allocation.subtotalMinor,
    taxMinor: allocation.taxMinor,
    tipMinor: allocation.tipMinor,
    discountMinor: allocation.discountMinor,
    itemsTotalMinor: itemsTotal === null ? null : itemsTotal.toString(),
    receiptTotalMinor: include ? manifest.receipt.totalMinor : null,
    items,
  };
}

/**
 * Creates local identifiers for a request before the relay reserves its access
 * capabilities. Nothing here is shown to a participant.
 */
export async function prepareRequest(
  manifest: BillManifest,
  participantId: string,
  options: { now?: string; replaceRequestId?: string; requestId?: string; obligationId?: string } = {},
): Promise<PreparedRequest> {
  assertActive(manifest);
  const allocation = assertPayableParticipant(manifest, participantId);
  const now = options.now ?? new Date().toISOString();
  if (!isTimestamp(now)) throw new Error("The request creation time is invalid.");
  const existing = manifest.requests.filter((entry) => entry.participantId === participantId && !entry.replacedBy &&
    (entry.lifecycle === "active" || entry.lifecycle === "expired"));
  let replacementFor: string | null = null;
  let obligationId = options.obligationId ?? randomId();
  if (options.replaceRequestId) {
    const previous = manifest.requests.find((entry) => entry.requestId === options.replaceRequestId);
    if (!previous) throw new Error("The request being replaced was not found.");
    if (previous.participantId !== participantId) throw new Error("Only the same participant's request can be replaced.");
    if (previous.replacedBy) throw new Error("This request has already been replaced.");
    replacementFor = previous.requestId;
    obligationId = previous.obligationId;
  } else if (existing.length) {
    throw new Error("This participant already has an active request. Cancel or replace it before creating another.");
  }
  const expiresAt = new Date(Date.parse(now) + manifest.expiryDays * DAY).toISOString();
  return {
    version: 1,
    requestId: options.requestId ?? randomId(),
    obligationId,
    participantId,
    participantLabel: manifest.participants.find((person) => person.id === participantId)!.label,
    reference: createReference(),
    contentKey: await generateContentKey(),
    amountZatoshis: allocation.zatoshis,
    address: manifest.receiving.address,
    network: manifest.receiving.network,
    createdAt: now,
    expiresAt,
    replacementFor,
  };
}

/** Persists the reservation in the encrypted manifest before the request is published. */
export function recordReservation(
  manifest: BillManifest,
  prepared: PreparedRequest,
  reservation: RequestReservation,
  now = new Date().toISOString(),
): BillManifest {
  assertActive(manifest);
  if (!isTimestamp(now)) throw new Error("The reservation time is invalid.");
  if (reservation.requestId !== prepared.requestId) throw new Error("The relay reserved a different request identifier.");
  const readCapability = assertCapability(reservation.readCapability, "The read capability");
  const reportCapability = assertCapability(reservation.reportCapability, "The report capability");
  if (readCapability === reportCapability) throw new Error("The relay issued dependent capabilities.");
  if (manifest.requests.some((entry) => entry.requestId === prepared.requestId)) throw new Error("This request is already in the manifest.");
  if (manifest.requests.some((entry) => entry.readCapability === readCapability || entry.reportCapability === reportCapability)) {
    throw new Error("The relay issued a capability that is already in use.");
  }
  const entry: RequestInventoryEntry = {
    requestId: prepared.requestId,
    obligationId: prepared.obligationId,
    participantId: prepared.participantId,
    participantLabel: prepared.participantLabel,
    reference: prepared.reference,
    contentKey: prepared.contentKey,
    readCapability,
    reportCapability,
    amountZatoshis: prepared.amountZatoshis,
    address: prepared.address,
    network: prepared.network,
    createdAt: prepared.createdAt,
    expiresAt: prepared.expiresAt,
    publishedAt: null,
    revokedAt: null,
    lifecycle: "active",
    replacementFor: prepared.replacementFor,
    replacedBy: null,
  };
  const next = snapshot(manifest);
  if (prepared.replacementFor) {
    const previous = next.requests.find((item) => item.requestId === prepared.replacementFor);
    if (!previous || previous.replacedBy) throw new Error("The request being replaced is no longer active.");
    previous.replacedBy = prepared.requestId;
    previous.lifecycle = "cancelled";
  }
  next.requests.push(entry);
  next.updatedAt = now;
  return validateBillManifest(next, manifest.billId);
}

/**
 * Signs and encrypts the immutable offer. The returned invitation must not be
 * displayed, logged or stored outside the encrypted manifest until the relay has
 * durably accepted the request envelope.
 */
export async function sealRequest(
  manifest: BillManifest,
  prepared: PreparedRequest,
  reservation: RequestReservation,
): Promise<SealedRequest> {
  assertActive(manifest);
  if (typeof prepared.contentKey !== "string" || !CAPABILITY.test(prepared.contentKey) || decodeBase64Url(prepared.contentKey).length !== 32) {
    throw new Error("Prepare the request content key before sealing it.");
  }
  const allocation = assertPayableParticipant(manifest, prepared.participantId);
  if (allocation.zatoshis !== prepared.amountZatoshis) throw new Error("The request amount changed after preparation.");
  const payload = buildRequestPayload({
    version: 1,
    requestId: prepared.requestId,
    obligationId: prepared.obligationId,
    reference: prepared.reference,
    participantLabel: prepared.participantLabel,
    amountZatoshis: integer(prepared.amountZatoshis, MAX_ZATOSHIS).toString(),
    address: prepared.address,
    network: prepared.network,
    createdAt: prepared.createdAt,
    expiresAt: prepared.expiresAt,
    disclosure: manifest.includeDetails ? "share-with-items" : "share-only",
    receipt: disclosure(manifest, allocation),
    organiserNote: null,
  });
  const { signJson, encryptJson } = await import("../private-workspace/crypto");
  const signed = await signJson(manifest.signing.privateKey, payload);
  const envelope = await encryptJson(prepared.contentKey, signed, {
    kind: "request", recordId: prepared.requestId, revision: 1,
  });
  const invite: InviteSecrets = {
    version: 1,
    requestId: prepared.requestId,
    readCapability: assertCapability(reservation.readCapability, "The read capability"),
    reportCapability: assertCapability(reservation.reportCapability, "The report capability"),
    publicKey: rawPublicKey(manifest.signing.publicKey),
    contentKey: prepared.contentKey,
  };
  return { payload: signed, envelope, contentKey: prepared.contentKey, invite };
}

/** Marks the request publishable only after the relay confirms its durable finalisation. */
export function markPublished(manifest: BillManifest, requestId: string, publishedAt = new Date().toISOString()): BillManifest {
  if (!isTimestamp(publishedAt)) throw new Error("The publication time is invalid.");
  const next = snapshot(manifest);
  const entry = next.requests.find((item) => item.requestId === requestId);
  if (!entry || entry.publishedAt) throw new Error("This request cannot be published from its current state.");
  if (entry.lifecycle !== "active" || entry.revokedAt) throw new Error("This request is no longer active.");
  entry.publishedAt = publishedAt;
  next.updatedAt = publishedAt;
  return validateBillManifest(next, manifest.billId);
}

export function markRevoked(manifest: BillManifest, requestId: string, revokedAt = new Date().toISOString()): BillManifest {
  if (!isTimestamp(revokedAt)) throw new Error("The revocation time is invalid.");
  const next = snapshot(manifest);
  const entry = next.requests.find((item) => item.requestId === requestId);
  if (!entry || entry.revokedAt) throw new Error("This request cannot be revoked from its current state.");
  entry.revokedAt = revokedAt;
  entry.lifecycle = "revoked";
  next.updatedAt = revokedAt;
  return validateBillManifest(next, manifest.billId);
}

export function markCancelled(manifest: BillManifest, requestId: string, cancelledAt = new Date().toISOString()): BillManifest {
  if (!isTimestamp(cancelledAt)) throw new Error("The cancellation time is invalid.");
  const next = snapshot(manifest);
  const entry = next.requests.find((item) => item.requestId === requestId);
  if (!entry || entry.revokedAt) throw new Error("This request cannot be cancelled from its current state.");
  entry.lifecycle = "cancelled";
  next.updatedAt = cancelledAt;
  return validateBillManifest(next, manifest.billId);
}

/** Archiving never transfers money and may be allowed with outstanding requests. */
export function setArchived(manifest: BillManifest, archived: boolean, at = new Date().toISOString()): BillManifest {
  if (!isTimestamp(at)) throw new Error("The archive time is invalid.");
  const next = snapshot(manifest);
  if (next.status === (archived ? "archived" : "active")) return next;
  next.status = archived ? "archived" : "active";
  next.archivedAt = archived ? at : null;
  next.updatedAt = at;
  return validateBillManifest(next, manifest.billId);
}

/** True when a request is still reserved but no envelope has been finalised. */
export function isUnpublished(entry: RequestInventoryEntry): boolean {
  return entry.publishedAt === null;
}

/** Rechecks the core invariant used by tests and the review screen. */
export function assertRequestSums(manifest: BillManifest): void {
  const total = manifest.allocations.reduce((sum, row) => sum + BigInt(row.zatoshis), 0n);
  if (total !== BigInt(manifest.conversion.wholeBillZatoshis)) throw new Error("The bill allocations do not sum to the approved ZEC total.");
}

export function isInviteShape(value: unknown): value is InviteSecrets {
  if (!hasExactKeys(value, ["version", "requestId", "readCapability", "reportCapability", "publicKey", "contentKey"])) {
    return false;
  }
  if (value.version !== 1 || !isUuid(value.requestId)) return false;
  for (const capability of [value.readCapability, value.reportCapability, value.contentKey]) {
    if (typeof capability !== "string" || !CAPABILITY.test(capability) || decodeBase64Url(capability).length !== 32) {
      return false;
    }
  }
  if (value.readCapability === value.reportCapability) return false;
  return typeof value.publicKey === "string" && /^[A-Za-z0-9_-]{86}$/.test(value.publicKey);
}

export { validateRequestPayload };

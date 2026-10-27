import { decodeBase64Url, encodeBase64Url, hasExactKeys, isTimestamp, isObject } from "../private-workspace/format";
import { MAX_ZATOSHIS, integer } from "../bills/money";
import { isReference, isUuid } from "../bills/manifest";
import type { Network, TrackingState } from "../bills/types";
import type {
  ConfirmationPayload, ImmutableRequestPayload, PaymentReportPayload, RequestReceiptDisclosure,
  RequestState, RequestSummary,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_NOTE = 280;
const MAX_REFERENCE = 200;

function timestamp(value: unknown, label: string): string {
  if (!isTimestamp(value)) throw new Error(`${label} must be an ISO 8601 timestamp.`);
  return value;
}

function text(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be between 1 and ${maximum} characters.`);
  }
  // Notes may contain line breaks and tabs; other control characters are rejected so
  // OCR or pasted text cannot smuggle terminal/format controls into the UI.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} contains unsupported characters.`);
  return value;
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === null) return null;
  return text(value, label, maximum);
}

function assertNetwork(value: unknown): asserts value is Network {
  if (value !== "testnet") throw new Error("The request network must be testnet.");
}

export function validateRequestReceipt(value: unknown): RequestReceiptDisclosure {
  if (!hasExactKeys(value, [
    "title", "currency", "scale", "shareMinor", "subtotalMinor", "taxMinor", "tipMinor", "discountMinor",
    "itemsTotalMinor", "receiptTotalMinor", "items",
  ])) throw new Error("The request receipt details are invalid.");
  const title = text(value.title, "The receipt title", 120);
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) throw new Error("The receipt currency is invalid.");
  if (!Number.isInteger(value.scale) || (value.scale as number) < 0 || (value.scale as number) > 3) throw new Error("The receipt precision is invalid.");
  const subtotal = integer(value.subtotalMinor as string);
  const tax = integer(value.taxMinor as string);
  const tip = integer(value.tipMinor as string);
  const discount = integer(value.discountMinor as string);
  const share = integer(value.shareMinor as string);
  if (subtotal + tax + tip - discount !== share) throw new Error("The request receipt arithmetic is invalid.");
  let itemsTotal: string | null = null;
  let receiptTotal: string | null = null;
  let items: { label: string; amountMinor: string }[] | null = null;
  if (value.items === null || value.itemsTotalMinor === null || value.receiptTotalMinor === null) {
    if (value.items !== null || value.itemsTotalMinor !== null || value.receiptTotalMinor !== null) {
      throw new Error("The disclosed receipt details are incomplete.");
    }
  } else {
    if (!Array.isArray(value.items) || value.items.length > 100) throw new Error("The disclosed receipt items are invalid.");
    items = value.items.map((item) => {
      if (!hasExactKeys(item, ["label", "amountMinor"])) throw new Error("A disclosed receipt item is invalid.");
      return { label: text(item.label, "A receipt item", 160), amountMinor: integer(item.amountMinor as string).toString() };
    });
    const sum = items.reduce((total, item) => total + BigInt(item.amountMinor), 0n);
    const claimedItems = integer(value.itemsTotalMinor as string);
    if (sum !== claimedItems) throw new Error("The disclosed receipt items do not match their stated total.");
    itemsTotal = claimedItems.toString();
    receiptTotal = integer(value.receiptTotalMinor as string).toString();
  }
  return {
    title, currency: value.currency, scale: value.scale as number, shareMinor: share.toString(),
    subtotalMinor: subtotal.toString(), taxMinor: tax.toString(), tipMinor: tip.toString(),
    discountMinor: discount.toString(), itemsTotalMinor: itemsTotal, receiptTotalMinor: receiptTotal, items,
  };
}

/** Validates the signed body of an immutable request. */
export function validateRequestPayload(value: unknown, expected?: {
  requestId?: string; obligationId?: string; reference?: string; amountZatoshis?: string;
  address?: string; network?: Network;
}): ImmutableRequestPayload {
  if (!hasExactKeys(value, [
    "version", "requestId", "obligationId", "reference", "participantLabel", "amountZatoshis",
    "address", "network", "createdAt", "expiresAt", "disclosure", "receipt", "organiserNote",
  ])) throw new Error("The request payload is invalid.");
  if (value.version !== 1 || !isUuid(value.requestId) || !isUuid(value.obligationId)) throw new Error("The request identifiers are invalid.");
  if (!isReference(value.reference)) throw new Error("The request reference is invalid.");
  if (expected?.requestId !== undefined && value.requestId !== expected.requestId) throw new Error("The request identifier does not match this invitation.");
  if (expected?.obligationId !== undefined && value.obligationId !== expected.obligationId) throw new Error("The request obligation does not match.");
  if (expected?.reference !== undefined && value.reference !== expected.reference) throw new Error("The request reference does not match.");
  const participantLabel = text(value.participantLabel, "The participant label", 60);
  const amount = integer(value.amountZatoshis as string, MAX_ZATOSHIS);
  if (amount === 0n) throw new Error("A zero-value request is not payable.");
  if (expected?.amountZatoshis !== undefined && amount.toString() !== integer(expected.amountZatoshis, MAX_ZATOSHIS).toString()) {
    throw new Error("The request amount does not match the review.");
  }
  if (typeof value.address !== "string" || !/^(?:ztestsapling1|utest1)[a-z0-9]{8,500}$/.test(value.address)) throw new Error("The receiving address must be a shielded testnet address.");
  if (expected?.address !== undefined && value.address !== expected.address) throw new Error("The receiving address does not match the bill.");
  assertNetwork(value.network);
  if (expected?.network !== undefined && value.network !== expected.network) throw new Error("The request network does not match the bill.");
  const createdAt = timestamp(value.createdAt, "The request creation time");
  const expiresAt = timestamp(value.expiresAt, "The request expiry");
  if (expiresAt <= createdAt) throw new Error("The request expiry is invalid.");
  if (value.disclosure !== "share-only" && value.disclosure !== "share-with-items") throw new Error("The request disclosure is invalid.");
  const receipt = validateRequestReceipt(value.receipt);
  if (value.disclosure === "share-with-items" && receipt.items === null) throw new Error("This request says it includes items but none were supplied.");
  if (value.disclosure === "share-only" && receipt.items !== null) throw new Error("This request discloses items it said it would omit.");
  return {
    version: 1, requestId: value.requestId, obligationId: value.obligationId, reference: value.reference,
    participantLabel, amountZatoshis: amount.toString(), address: value.address, network: value.network,
    createdAt, expiresAt, disclosure: value.disclosure, receipt, organiserNote: optionalText(value.organiserNote, "The organiser note", MAX_NOTE),
  };
}

export function validatePaymentReportPayload(value: unknown, expected?: { requestId?: string; obligationId?: string }): PaymentReportPayload {
  if (!hasExactKeys(value, ["version", "requestId", "obligationId", "claimedZatoshis", "reportedAt", "reference", "note"])) {
    throw new Error("The payment report is invalid.");
  }
  if (value.version !== 1 || !isUuid(value.requestId) || !isUuid(value.obligationId)) throw new Error("The payment report identifiers are invalid.");
  if (expected?.requestId !== undefined && value.requestId !== expected.requestId) throw new Error("The payment report belongs to another request.");
  if (expected?.obligationId !== undefined && value.obligationId !== expected.obligationId) throw new Error("The payment report belongs to another obligation.");
  const claimed = integer(value.claimedZatoshis as string, MAX_ZATOSHIS);
  if (claimed === 0n) throw new Error("Enter the amount you actually sent.");
  const reportedAt = timestamp(value.reportedAt, "The payment report time");
  if (Date.parse(reportedAt) > Date.now() + 5 * 60_000) throw new Error("The payment report time is in the future.");
  return {
    version: 1, requestId: value.requestId, obligationId: value.obligationId, claimedZatoshis: claimed.toString(),
    reportedAt, reference: optionalText(value.reference, "The payment reference", MAX_REFERENCE),
    note: optionalText(value.note, "The payment note", MAX_NOTE),
  };
}

export function validateConfirmationPayload(value: unknown, expected?: {
  requestId?: string; obligationId?: string; requestedZatoshis?: string;
}): ConfirmationPayload {
  if (!hasExactKeys(value, [
    "version", "requestId", "obligationId", "receivedTotalZatoshis", "outcome", "confirmedAt",
    "note", "correctionReason", "previousConfirmationId",
  ])) throw new Error("The organiser confirmation is invalid.");
  if (value.version !== 1 || !isUuid(value.requestId) || !isUuid(value.obligationId)) throw new Error("The confirmation identifiers are invalid.");
  if (expected?.requestId !== undefined && value.requestId !== expected.requestId) throw new Error("The confirmation belongs to another request.");
  if (expected?.obligationId !== undefined && value.obligationId !== expected.obligationId) throw new Error("The confirmation belongs to another obligation.");
  const received = integer(value.receivedTotalZatoshis as string, MAX_ZATOSHIS);
  if (!["partially_confirmed", "confirmed_by_organiser", "overpaid", "correction"].includes(value.outcome as string)) {
    throw new Error("The confirmation outcome is invalid.");
  }
  const confirmedAt = timestamp(value.confirmedAt, "The confirmation time");
  if (Date.parse(confirmedAt) > Date.now() + 5 * 60_000) throw new Error("The confirmation time is in the future.");
  const note = optionalText(value.note, "The confirmation note", MAX_NOTE);
  const correctionReason = optionalText(value.correctionReason, "The correction reason", MAX_NOTE);
  if (value.previousConfirmationId !== null && !isUuid(value.previousConfirmationId)) throw new Error("The previous confirmation identifier is invalid.");
  if ((value.outcome === "correction") !== (correctionReason !== null)) throw new Error("A correction needs an explicit reason, and only a correction carries one.");
  if (value.outcome === "correction" && value.previousConfirmationId === null) throw new Error("A correction must reference the confirmation it replaces.");
  if (value.outcome !== "correction" && value.previousConfirmationId !== null) throw new Error("Only a correction may reference a previous confirmation.");
  if (expected?.requestedZatoshis !== undefined) {
    const requested = integer(expected.requestedZatoshis, MAX_ZATOSHIS);
    if (value.outcome !== "correction") {
      const derived = received === 0n ? null : received < requested ? "partially_confirmed" : received === requested ? "confirmed_by_organiser" : "overpaid";
      if (derived !== value.outcome) throw new Error("The confirmation amount does not match its outcome.");
    }
  }
  return {
    version: 1, requestId: value.requestId, obligationId: value.obligationId, receivedTotalZatoshis: received.toString(),
    outcome: value.outcome as ConfirmationPayload["outcome"], confirmedAt, note, correctionReason,
    previousConfirmationId: value.previousConfirmationId,
  };
}

export function buildRequestPayload(input: ImmutableRequestPayload): ImmutableRequestPayload {
  return validateRequestPayload(input);
}

export function buildPaymentReportPayload(input: PaymentReportPayload): PaymentReportPayload {
  return validatePaymentReportPayload(input);
}

export function buildConfirmationPayload(input: ConfirmationPayload, requestedZatoshis: string): ConfirmationPayload {
  return validateConfirmationPayload(input, { requestId: input.requestId, obligationId: input.obligationId, requestedZatoshis });
}

/** Latest confirmation sorted by time then record ID, which makes the win deterministic. */
export function latestConfirmation(state: Pick<RequestState, "confirmations">) {
  return [...state.confirmations].sort((left, right) =>
    left.confirmedAt === right.confirmedAt ? (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) : left.confirmedAt < right.confirmedAt ? -1 : 1,
  ).at(-1);
}

export function confirmedTotal(state: Pick<RequestState, "confirmations">): bigint {
  const latest = latestConfirmation(state);
  return latest ? BigInt(latest.payload.receivedTotalZatoshis) : 0n;
}

/**
 * Payments are tracked separately from lifecycle. A report alone never confirms
 * a payment, and a full confirmation remains full even when the request expires.
 */
export function trackingOf(state: Pick<RequestState, "payload" | "reports" | "confirmations">): TrackingState {
  const latest = latestConfirmation(state);
  if (latest) {
    const total = BigInt(latest.payload.receivedTotalZatoshis);
    if (total > 0n) return total >= BigInt(state.payload.payload.amountZatoshis) ? "confirmed_by_organiser" : "partially_confirmed";
    return "unpaid";
  }
  return state.reports.length ? "payment_reported" : "unpaid";
}

export function lifecycleOf(state: Pick<RequestState, "lifecycle" | "revoked" | "payload">, now = Date.now()): RequestState["lifecycle"] {
  if (state.revoked) return "revoked";
  if (state.lifecycle === "cancelled") return "cancelled";
  if (Date.parse(state.payload.payload.expiresAt) <= now) return "expired";
  return "active";
}

export function requestSummary(state: RequestState, now = Date.now()): RequestSummary {
  const latest = latestConfirmation(state);
  return {
    requestId: state.requestId,
    obligationId: state.payload.payload.obligationId,
    participantLabel: state.payload.payload.participantLabel,
    amountZatoshis: state.payload.payload.amountZatoshis,
    confirmedZatoshis: (latest ? BigInt(latest.payload.receivedTotalZatoshis) : 0n).toString(),
    tracking: trackingOf(state),
    lifecycle: lifecycleOf(state, now),
    expiresAt: state.payload.payload.expiresAt,
    reports: state.reports.length,
    confirmations: state.confirmations.length,
  };
}

export function rawPublicKey(publicKey: JsonWebKey): string {
  if (!isObject(publicKey) || publicKey.kty !== "EC" || publicKey.crv !== "P-256" ||
    typeof publicKey.x !== "string" || typeof publicKey.y !== "string") {
    throw new Error("The pinned signing key is invalid.");
  }
  const x = decodeBase64Url(publicKey.x);
  const y = decodeBase64Url(publicKey.y);
  if (x.length !== 32 || y.length !== 32) throw new Error("The pinned signing key is invalid.");
  const raw = new Uint8Array(64);
  raw.set(x, 0);
  raw.set(y, 32);
  return encodeBase64Url(raw);
}

export function publicKeyFromRaw(raw: string): JsonWebKey {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(raw)) throw new Error("The pinned signing key is invalid.");
  const bytes = decodeBase64Url(raw);
  if (bytes.length !== 64) throw new Error("The pinned signing key is invalid.");
  return { kty: "EC", crv: "P-256", x: encodeBase64Url(bytes.slice(0, 32)), y: encodeBase64Url(bytes.slice(32)) };
}

export { UUID };

import {
  assertRecordId, decodeBase64Url, hasExactKeys, isTimestamp, isObject,
} from "../private-workspace/format";
import { MAX_ZATOSHIS, integer } from "./money";
import { allocateBill, validateParticipants, validateReceipt } from "./split";
import type {
  Allocation, BillManifest, CreateBillManifestInput, Participant, RequestInventoryEntry, SignedKeys,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REFERENCE = /^splyt-[a-f0-9]{32}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;

export const MAX_EXPIRY_DAYS = 90;
export const MIN_EXPIRY_DAYS = 1;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function isReference(value: unknown): value is string {
  return typeof value === "string" && REFERENCE.test(value);
}

function assertTimestamp(value: unknown, label: string): asserts value is string {
  if (!isTimestamp(value)) throw new Error(`${label} must be an ISO 8601 timestamp.`);
}

function assertSecret(value: unknown, label: string): string {
  if (typeof value !== "string" || !CAPABILITY.test(value) || decodeBase64Url(value).length !== 32) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function assertPublicKey(value: unknown): JsonWebKey {
  if (!isObject(value) || value.kty !== "EC" || value.crv !== "P-256") throw new Error("The bill signing key is invalid.");
  for (const coordinate of ["x", "y"]) {
    if (typeof value[coordinate] !== "string" || !BASE64URL.test(value[coordinate]) || decodeBase64Url(value[coordinate]).length !== 32) {
      throw new Error("The bill signing key is invalid.");
    }
  }
  return value as JsonWebKey;
}

function assertSigningMaterial(value: unknown): SignedKeys {
  if (!hasExactKeys(value, ["publicKey", "privateKey"])) throw new Error("The bill signing material is invalid.");
  const publicKey = assertPublicKey(value.publicKey);
  if (!isObject(value.privateKey) || value.privateKey.kty !== "EC" || value.privateKey.crv !== "P-256" ||
    typeof value.privateKey.d !== "string" || !BASE64URL.test(value.privateKey.d) || decodeBase64Url(value.privateKey.d).length !== 32 ||
    value.privateKey.x !== publicKey.x || value.privateKey.y !== publicKey.y) {
    throw new Error("The bill signing material is invalid.");
  }
  return { publicKey, privateKey: value.privateKey as JsonWebKey };
}

function assertReceiving(value: unknown): void {
  if (isObject(value) && value.network !== "testnet") throw new Error("The receiving network must be testnet.");
  if (!hasExactKeys(value, ["address", "network", "type", "receivers"]) ||
    typeof value.address !== "string" || !/^[A-Za-z0-9]{20,512}$/.test(value.address) ||
    value.network !== "testnet" ||
    (value.type !== "sapling" && value.type !== "unified") ||
    !Array.isArray(value.receivers) || value.receivers.length < 1 || value.receivers.length > 2 ||
    value.receivers.some((receiver) => receiver !== "sapling" && receiver !== "orchard") ||
    new Set(value.receivers).size !== value.receivers.length) {
    throw new Error("The receiving address details are invalid.");
  }
  if (/^(ztestsapling1|utest1)/.test(value.address) !== (value.network === "testnet")) {
    throw new Error("The receiving address does not match the selected network.");
  }
}

function assertAllocation(value: unknown): Allocation {
  if (!isObject(value) ||
    !hasExactKeys(value, ["participantId", "subtotalMinor", "taxMinor", "tipMinor", "discountMinor", "shareMinor", "zatoshis", "isOrganiser"])) {
    throw new Error("The allocation inventory is invalid.");
  }
  if (typeof value.participantId !== "string" || typeof value.isOrganiser !== "boolean") {
    throw new Error("The allocation inventory is invalid.");
  }
  for (const field of ["subtotalMinor", "taxMinor", "tipMinor", "discountMinor", "shareMinor"] as const) {
    integer(value[field] as string);
  }
  integer(value.zatoshis as string, MAX_ZATOSHIS);
  return value as unknown as Allocation;
}

function compareAllocations(expected: Allocation[], stored: Allocation[]): void {
  if (expected.length !== stored.length) throw new Error("The stored allocations do not match the reviewed bill.");
  for (let index = 0; index < expected.length; index++) {
    const original = expected[index];
    const current = stored[index];
    if (!current || current.participantId !== original.participantId || current.isOrganiser !== original.isOrganiser ||
      current.subtotalMinor !== original.subtotalMinor || current.taxMinor !== original.taxMinor ||
      current.tipMinor !== original.tipMinor || current.discountMinor !== original.discountMinor ||
      current.shareMinor !== original.shareMinor || current.zatoshis !== original.zatoshis) {
      throw new Error("The stored allocations do not match the reviewed bill.");
    }
  }
}

function assertRequestEntry(value: unknown, manifest: Pick<BillManifest, "receiving" | "participants" | "allocations">, entries: RequestInventoryEntry[]): RequestInventoryEntry {
  if (!hasExactKeys(value, [
    "requestId", "obligationId", "participantId", "participantLabel", "reference", "contentKey",
    "readCapability", "reportCapability", "amountZatoshis", "address", "network", "createdAt",
    "expiresAt", "publishedAt", "revokedAt", "lifecycle", "replacementFor", "replacedBy",
  ])) throw new Error("A request inventory entry is invalid.");
  if (!isUuid(value.requestId) || !isUuid(value.obligationId)) throw new Error("A request inventory ID is invalid.");
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.expiresAt) || value.expiresAt <= value.createdAt) {
    throw new Error("A request expiry is invalid.");
  }
  if (value.publishedAt !== null && !isTimestamp(value.publishedAt)) throw new Error("A request publication time is invalid.");
  if (value.revokedAt !== null && !isTimestamp(value.revokedAt)) throw new Error("A request revocation time is invalid.");
  if (!["active", "expired", "revoked", "cancelled"].includes(value.lifecycle as string)) throw new Error("A request lifecycle state is invalid.");
  if ((value.lifecycle === "revoked") !== (value.revokedAt !== null)) throw new Error("A request lifecycle state is inconsistent.");
  if (value.replacementFor !== null && !isUuid(value.replacementFor)) throw new Error("A replacement reference is invalid.");
  if (value.replacedBy !== null && !isUuid(value.replacedBy)) throw new Error("A replacement reference is invalid.");
  if (!isReference(value.reference)) throw new Error("A request reference is invalid.");
  const contentKey = assertSecret(value.contentKey, "A request content key");
  const read = assertSecret(value.readCapability, "A request read capability");
  const report = assertSecret(value.reportCapability, "A request report capability");
  if (read === report || contentKey === read || contentKey === report) {
    throw new Error("Request capabilities must be independent.");
  }
  const participant = manifest.participants.find((person) => person.id === value.participantId);
  if (!participant || participant.isOrganiser || participant.label !== value.participantLabel) {
    throw new Error("Request inventory includes an unknown or organiser share.");
  }
  const allocation = manifest.allocations.find((row) => row.participantId === value.participantId);
  if (!allocation || allocation.isOrganiser || allocation.zatoshis !== value.amountZatoshis || integer(value.amountZatoshis as string, MAX_ZATOSHIS) === 0n) {
    throw new Error("A request amount does not match the reviewed allocation.");
  }
  if (value.address !== manifest.receiving.address || value.network !== manifest.receiving.network) {
    throw new Error("A request address does not match the bill's receiving address.");
  }
  const secrets = new Set([contentKey, read, report]);
  if (entries.some((entry) => entry.requestId === value.requestId || entry.reference === value.reference ||
    secrets.has(entry.contentKey) || secrets.has(entry.readCapability) || secrets.has(entry.reportCapability))) {
    throw new Error("Request inventory contains duplicate identifiers or capabilities.");
  }
  return value as unknown as RequestInventoryEntry;
}

function assertReplacementGraph(entries: RequestInventoryEntry[]): void {
  const byId = new Map(entries.map((entry) => [entry.requestId, entry]));
  for (const entry of entries) {
    if (entry.replacedBy) {
      const next = byId.get(entry.replacedBy);
      if (!next || next.replacementFor !== entry.requestId) throw new Error("A request replacement link is inconsistent.");
    }
    if (entry.replacementFor) {
      const previous = byId.get(entry.replacementFor);
      if (!previous || previous.replacedBy !== entry.requestId) throw new Error("A request replacement link is inconsistent.");
      if (previous.obligationId !== entry.obligationId) throw new Error("Replacements must preserve the private obligation.");
      if (previous.participantId !== entry.participantId) throw new Error("Replacements must preserve the participant.");
    }
  }
  const activeObligations = new Set<string>();
  for (const entry of entries) {
    if (entry.replacedBy || entry.lifecycle === "revoked" || entry.lifecycle === "cancelled" || !entry.publishedAt) continue;
    if (activeObligations.has(entry.obligationId)) throw new Error("An obligation cannot have more than one active request.");
    activeObligations.add(entry.obligationId);
  }
}

/** Strictly validates an organiser manifest, including recomputing every allocation. */
export function validateBillManifest(value: unknown, expectedBillId?: string): BillManifest {
  if (!hasExactKeys(value, [
    "version", "billId", "createdAt", "updatedAt", "status", "archivedAt", "title", "receipt",
    "participants", "mode", "allocations", "conversion", "receiving", "signing", "includeDetails",
    "expiryDays", "requests",
  ])) throw new Error("The bill manifest is invalid.");
  if (value.version !== 1 || !isUuid(value.billId) || (expectedBillId !== undefined && value.billId !== expectedBillId)) {
    throw new Error("The bill manifest identifier is invalid.");
  }
  assertTimestamp(value.createdAt, "The bill creation time");
  assertTimestamp(value.updatedAt, "The bill update time");
  if (value.updatedAt < value.createdAt) throw new Error("The bill update time is invalid.");
  if (value.status !== "active" && value.status !== "archived") throw new Error("The bill status is invalid.");
  if ((value.status === "archived") !== (value.archivedAt !== null)) throw new Error("The bill archive state is inconsistent.");
  if (value.archivedAt !== null) assertTimestamp(value.archivedAt, "The bill archive time");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 120) throw new Error("The bill title is invalid.");
  if (typeof value.includeDetails !== "boolean") throw new Error("The disclosure setting is invalid.");
  if (!Number.isInteger(value.expiryDays) || (value.expiryDays as number) < MIN_EXPIRY_DAYS || (value.expiryDays as number) > MAX_EXPIRY_DAYS) {
    throw new Error("The request expiry must be between 1 and 90 days.");
  }
  if (!isObject(value.receipt) || value.receipt.title !== value.title) throw new Error("The receipt title is invalid.");
  validateReceipt(value.receipt as never);
  if (!Array.isArray(value.participants)) throw new Error("The participant inventory is invalid.");
  validateParticipants(value.participants as Participant[]);
  if (value.mode !== "equal" && value.mode !== "custom" && value.mode !== "itemised") throw new Error("The split mode is invalid.");
  if (!isObject(value.conversion) || !hasExactKeys(value.conversion, ["source", "wholeBillZatoshis", "approvedAt", "quote"])) {
    throw new Error("The approved conversion is invalid.");
  }
  if (value.conversion.source !== "manual" && value.conversion.source !== "coingecko") throw new Error("The approved conversion source is invalid.");
  if (value.conversion.source === "manual" && value.conversion.quote !== null) throw new Error("A manual conversion cannot carry a market quote.");
  if (value.conversion.source === "coingecko" && (!isObject(value.conversion.quote) || value.conversion.quote.source !== "coingecko")) {
    throw new Error("The approved market quote is invalid.");
  }
  assertTimestamp(value.conversion.approvedAt, "The conversion approval time");
  const wholeBill = integer(value.conversion.wholeBillZatoshis as string, MAX_ZATOSHIS);
  if (wholeBill === 0n) throw new Error("Approve a positive whole-bill ZEC amount before publishing.");
  assertReceiving(value.receiving);
  assertSigningMaterial(value.signing);
  if (!Array.isArray(value.allocations)) throw new Error("The allocation inventory is invalid.");
  const stored = value.allocations.map(assertAllocation);
  const expected = allocateBill(value.receipt as never, value.participants as Participant[], value.mode, value.conversion.wholeBillZatoshis as string);
  compareAllocations(expected, stored);
  if (!Array.isArray(value.requests) || value.requests.length > 150) throw new Error("The request inventory is invalid.");
  const entries: RequestInventoryEntry[] = [];
  for (const entry of value.requests) {
    entries.push(assertRequestEntry(entry, {
      receiving: value.receiving as never,
      participants: value.participants as Participant[],
      allocations: stored,
    }, entries));
  }
  assertReplacementGraph(entries);
  return value as unknown as BillManifest;
}

/** Creates a frozen organiser manifest after the reviewed allocations and quote are approved. */
export async function createBillManifest(input: CreateBillManifestInput): Promise<BillManifest> {
  const { generateSigningKeys, randomId } = await import("../private-workspace/crypto");
  const billId = input.billId ?? randomId();
  if (!isUuid(billId)) throw new Error("A bill needs a random identifier.");
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 120) throw new Error("Enter a bill title of up to 120 characters.");
  if (input.receipt.title !== input.title) throw new Error("The receipt and bill titles must match.");
  if (!Number.isInteger(input.expiryDays) || input.expiryDays < MIN_EXPIRY_DAYS || input.expiryDays > MAX_EXPIRY_DAYS) {
    throw new Error("Choose a request expiry between 1 and 90 days.");
  }
  if (typeof input.includeDetails !== "boolean") throw new Error("Choose whether requests include receipt items.");
  validateReceipt(input.receipt);
  validateParticipants(input.participants);
  if (!isTimestamp(input.conversion.approvedAt)) throw new Error("The conversion approval time is invalid.");
  if (input.conversion.source === "manual" && input.conversion.quote !== null) throw new Error("A manual conversion cannot carry a market quote.");
  if (input.conversion.source === "coingecko" && (!input.conversion.quote || input.conversion.quote.source !== "coingecko")) {
    throw new Error("Approve a market quote before using it for a bill.");
  }
  const wholeBill = integer(input.conversion.wholeBillZatoshis, MAX_ZATOSHIS);
  if (wholeBill === 0n) throw new Error("Approve a positive whole-bill ZEC amount.");
  assertReceiving(input.receiving);
  const allocations = allocateBill(input.receipt, input.participants, input.mode, input.conversion.wholeBillZatoshis);
  const signing = await generateSigningKeys();
  const now = input.now ?? new Date().toISOString();
  assertTimestamp(now, "The bill creation time");
  const manifest: BillManifest = {
    version: 1,
    billId,
    createdAt: now,
    updatedAt: now,
    status: "active",
    archivedAt: null,
    title: input.title,
    receipt: input.receipt,
    participants: input.participants,
    mode: input.mode,
    allocations,
    conversion: input.conversion,
    receiving: input.receiving,
    signing: signing as SignedKeys,
    includeDetails: input.includeDetails,
    expiryDays: input.expiryDays,
    requests: [],
  };
  return validateBillManifest(manifest);
}

/** Non-organiser allocations with a positive amount, in stable participant order. */
export function payableAllocations(manifest: BillManifest): Allocation[] {
  return manifest.allocations.filter((allocation) => {
    const participant = manifest.participants.find((person) => person.id === allocation.participantId);
    return Boolean(participant && !participant.isOrganiser && !allocation.isOrganiser) && integer(allocation.zatoshis, MAX_ZATOSHIS) > 0n;
  });
}

/** The private invitation must never be shown for a share that is not payable. */
export function assertPayableParticipant(manifest: BillManifest, participantId: string): Allocation {
  const allocation = payableAllocations(manifest).find((row) => row.participantId === participantId);
  if (!allocation) throw new Error("This participant has no amount to reimburse.");
  return allocation;
}

export { assertRecordId };

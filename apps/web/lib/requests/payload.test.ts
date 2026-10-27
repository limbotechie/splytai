import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildConfirmationPayload, buildPaymentReportPayload, buildRequestPayload, confirmedTotal,
  latestConfirmation, lifecycleOf, publicKeyFromRaw, rawPublicKey, requestSummary, trackingOf,
  validateConfirmationPayload, validatePaymentReportPayload, validateRequestPayload,
} from "./payload";
import type { ConfirmationPayload, ImmutableRequestPayload, PaymentReportPayload, RequestState } from "./types";
import { encodeBase64Url, generateSigningKeys } from "../private-workspace/crypto";
import { installCrypto } from "../private-workspace/test-support";

const TESTNET_SAPLING = "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const OBLIGATION_ID = "22222222-2222-4222-8222-222222222222";
const REFERENCE = "splyt-0123456789abcdef0123456789abcdef";
const CREATED = "2026-03-01T10:00:00.000Z";
const EXPIRES = "2026-03-15T10:00:00.000Z";

function disclosure(items = false): Record<string, unknown> {
  return items ? {
    title: "Dinner", currency: "USD", scale: 2, shareMinor: "1200", subtotalMinor: "1000",
    taxMinor: "200", tipMinor: "0", discountMinor: "0", itemsTotalMinor: "1000",
    receiptTotalMinor: "1200", items: [{ label: "Fries", amountMinor: "1000" }],
  } : {
    title: "Dinner", currency: "USD", scale: 2, shareMinor: "1200", subtotalMinor: "1000",
    taxMinor: "200", tipMinor: "0", discountMinor: "0", itemsTotalMinor: null,
    receiptTotalMinor: null, items: null,
  };
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, requestId: REQUEST_ID, obligationId: OBLIGATION_ID, reference: REFERENCE,
    participantLabel: "Alice", amountZatoshis: "1200", address: TESTNET_SAPLING, network: "testnet",
    createdAt: CREATED, expiresAt: EXPIRES, disclosure: "share-only", receipt: disclosure(),
    organiserNote: null, ...overrides,
  };
}

function report(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, requestId: REQUEST_ID, obligationId: OBLIGATION_ID, claimedZatoshis: "600",
    reportedAt: "2026-03-01T11:00:00.000Z", reference: null, note: null, ...overrides,
  };
}

function confirmation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1, requestId: REQUEST_ID, obligationId: OBLIGATION_ID, receivedTotalZatoshis: "600",
    outcome: "partially_confirmed", confirmedAt: "2026-03-01T12:00:00.000Z", note: null,
    correctionReason: null, previousConfirmationId: null, ...overrides,
  };
}

function state(overrides: Partial<RequestState> = {}): RequestState {
  return {
    version: 1,
    requestId: REQUEST_ID,
    billId: null,
    role: "organiser",
    payload: { payload: request() as unknown as ImmutableRequestPayload, signature: "A".repeat(86) },
    pinnedPublicKey: "A".repeat(86),
    contentKey: "A".repeat(43),
    revision: 1,
    reports: [],
    confirmations: [],
    revoked: false,
    retainedUntil: EXPIRES,
    lifecycle: "active",
    lastSyncedAt: null,
    ...overrides,
  };
}

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("immutable request payloads", () => {
  it("validates and normalises a signed offer", () => {
    const payload = validateRequestPayload(request());
    expect(payload).toMatchObject({
      requestId: REQUEST_ID, amountZatoshis: "1200", network: "testnet",
      disclosure: "share-only", organiserNote: null,
    });
    expect(payload.receipt.items).toBeNull();
  });

  it("accepts itemised disclosure only when the items reconcile", () => {
    const payload = validateRequestPayload(request({ disclosure: "share-with-items", receipt: disclosure(true) }));
    expect(payload.receipt.items).toEqual([{ label: "Fries", amountMinor: "1000" }]);
    expect(() => validateRequestPayload(request({ receipt: disclosure(true) }))).toThrow(/omit|includes/);
    expect(() => validateRequestPayload(request({
      disclosure: "share-with-items",
      receipt: { ...disclosure(true), itemsTotalMinor: "900" },
    }))).toThrow(/do not match/);
    expect(() => validateRequestPayload(request({
      disclosure: "share-with-items",
      receipt: { ...disclosure(true), shareMinor: "1201" },
    }))).toThrow(/arithmetic/);
    expect(() => validateRequestPayload(request({
      disclosure: "share-with-items",
      receipt: { ...disclosure(true), discountMinor: "1" },
    }))).toThrow(/arithmetic/);
  });

  it("rejects identity, amount, address, expiry and disclosure mismatches", () => {
    expect(() => validateRequestPayload(request(), { requestId: "33333333-3333-4333-8333-333333333333" })).toThrow(/identifier/);
    expect(() => validateRequestPayload(request(), { obligationId: REQUEST_ID })).toThrow(/obligation/);
    expect(() => validateRequestPayload(request(), { reference: "splyt-ffffffffffffffffffffffffffffffff" })).toThrow(/reference/);
    expect(() => validateRequestPayload(request(), { amountZatoshis: "1201" })).toThrow(/amount/);
    expect(() => validateRequestPayload(request(), { address: "zs1other" })).toThrow(/address/);
    expect(() => validateRequestPayload(request(), { network: "mainnet" })).toThrow(/network/);
    expect(() => validateRequestPayload(request({ amountZatoshis: "0" }))).toThrow(/zero/);
    expect(() => validateRequestPayload(request({ expiresAt: CREATED }))).toThrow(/expiry/);
    expect(() => validateRequestPayload(request({ createdAt: "2026-03-01" }))).toThrow(/timestamp/);
    expect(() => validateRequestPayload(request({ disclosure: "everything" }))).toThrow(/disclosure/);
    expect(() => validateRequestPayload(request({ address: "t1transparent" }))).toThrow(/address/);
    expect(() => validateRequestPayload(request({ network: "regtest" }))).toThrow(/network/);
    expect(() => validateRequestPayload(request({ network: "mainnet" }))).toThrow(/testnet/);
  });

  it("rejects extra fields and control characters", () => {
    expect(() => validateRequestPayload(request({ extra: true }))).toThrow(/payload is invalid/);
    expect(() => validateRequestPayload(request({ participantLabel: "Alice\u0007" }))).toThrow(/unsupported characters/);
    expect(() => validateRequestPayload(request({ participantLabel: "" }))).toThrow(/participant label/);
    expect(() => validateRequestPayload(request({ organiserNote: "x".repeat(281) }))).toThrow(/organiser note/);
    expect(() => validateRequestPayload(request({ reference: "splyt-short" }))).toThrow(/reference/);
  });

  it("refuses to build a payload it cannot validate", () => {
    expect(() => buildRequestPayload(request() as unknown as ImmutableRequestPayload)).not.toThrow();
    expect(() => buildRequestPayload(request({ amountZatoshis: "0" }) as never)).toThrow();
  });
});

describe("participant payment reports", () => {
  it("validates a bounded, non-zero report", () => {
    const payload = validatePaymentReportPayload(report(), { requestId: REQUEST_ID, obligationId: OBLIGATION_ID });
    expect(payload.claimedZatoshis).toBe("600");
    expect(buildPaymentReportPayload(payload)).toEqual(payload);
  });

  it("rejects wrong ownership, zero, future and oversized values", () => {
    expect(() => validatePaymentReportPayload(report(), { requestId: "33333333-3333-4333-8333-333333333333" })).toThrow(/another request/);
    expect(() => validatePaymentReportPayload(report(), { obligationId: "33333333-3333-4333-8333-333333333333" })).toThrow(/another obligation/);
    expect(() => validatePaymentReportPayload(report({ claimedZatoshis: "0" }))).toThrow(/amount you actually sent/);
    expect(() => validatePaymentReportPayload(report({ claimedZatoshis: "2100000000000001" }))).toThrow(/limit/);
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(() => validatePaymentReportPayload(report({ reportedAt: future }))).toThrow(/future/);
    expect(() => validatePaymentReportPayload(report({ note: "x".repeat(281) }))).toThrow(/note/);
    expect(() => validatePaymentReportPayload(report({ note: "bad\u0001" }))).toThrow(/unsupported characters/);
    expect(() => validatePaymentReportPayload(report({ extra: "x" }))).toThrow(/report is invalid/);
    expect(() => validatePaymentReportPayload(report({ claimedZatoshis: "-1" }))).toThrow(/whole number/);
  });
});

describe("cumulative organiser confirmations", () => {
  it("derives the outcome from the cumulative received total", () => {
    expect(validateConfirmationPayload(confirmation(), { requestedZatoshis: "1200" }).outcome).toBe("partially_confirmed");
    expect(validateConfirmationPayload(confirmation({ receivedTotalZatoshis: "1200", outcome: "confirmed_by_organiser" }), { requestedZatoshis: "1200" }).outcome)
      .toBe("confirmed_by_organiser");
    expect(() => validateConfirmationPayload(confirmation({ receivedTotalZatoshis: "1200" }), { requestedZatoshis: "1200" }))
      .toThrow(/does not match/);
    expect(validateConfirmationPayload(confirmation({ receivedTotalZatoshis: "1300", outcome: "overpaid" }), { requestedZatoshis: "1200" }).outcome)
      .toBe("overpaid");
    expect(() => validateConfirmationPayload(confirmation({ outcome: "confirmed_by_organiser" }), { requestedZatoshis: "1200" }))
      .toThrow(/does not match/);
    expect(() => validateConfirmationPayload(confirmation({ receivedTotalZatoshis: "0" }), { requestedZatoshis: "1200" }))
      .toThrow(/does not match/);
  });

  it("requires an explicit, linked correction and forbids stray fields", () => {
    const previous = "44444444-4444-4444-8444-444444444444";
    const corrected = confirmation({
      receivedTotalZatoshis: "1200", outcome: "correction", correctionReason: "Recorded the wrong transfer.",
      previousConfirmationId: previous,
    });
    expect(validateConfirmationPayload(corrected, { requestedZatoshis: "1200" }).outcome).toBe("correction");
    expect(() => validateConfirmationPayload(confirmation({ outcome: "correction", correctionReason: "reason" }))).toThrow(/reference/);
    expect(() => validateConfirmationPayload(confirmation({ outcome: "correction", previousConfirmationId: previous }))).toThrow(/reason/);
    expect(() => validateConfirmationPayload(confirmation({ correctionReason: "reason" }))).toThrow(/only a correction/);
    expect(() => validateConfirmationPayload(confirmation({ previousConfirmationId: previous }))).toThrow(/Only a correction/);
    expect(() => validateConfirmationPayload(confirmation({ correctionReason: null, outcome: "overpaid", receivedTotalZatoshis: "1300" }), { requestedZatoshis: "1200" })).not.toThrow();
  });

  it("rejects wrong ownership, zero, future times and oversized notes", () => {
    expect(() => validateConfirmationPayload(confirmation(), { requestId: "33333333-3333-4333-8333-333333333333" })).toThrow(/another request/);
    expect(() => validateConfirmationPayload(confirmation({ receivedTotalZatoshis: "-1" }))).toThrow(/whole number/);
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    expect(() => validateConfirmationPayload(confirmation({ confirmedAt: future }))).toThrow(/future/);
    expect(() => validateConfirmationPayload(confirmation({ note: "x".repeat(281) }))).toThrow(/note/);
    expect(() => buildConfirmationPayload(confirmation({ outcome: "overpaid", receivedTotalZatoshis: "1300" }) as unknown as ConfirmationPayload, "1000"))
      .not.toThrow();
  });
});

describe("tracking is separate from lifecycle", () => {
  const reported: PaymentReportPayload = {
    version: 1, requestId: REQUEST_ID, obligationId: OBLIGATION_ID, claimedZatoshis: "600",
    reportedAt: "2026-03-01T11:00:00.000Z", reference: null, note: null,
  };
  const partial: ConfirmationPayload = {
    version: 1, requestId: REQUEST_ID, obligationId: OBLIGATION_ID, receivedTotalZatoshis: "600",
    outcome: "partially_confirmed", confirmedAt: "2026-03-01T12:00:00.000Z", note: null,
    correctionReason: null, previousConfirmationId: null,
  };
  const full: ConfirmationPayload = { ...partial, receivedTotalZatoshis: "1200", outcome: "confirmed_by_organiser", confirmedAt: "2026-03-01T13:00:00.000Z" };

  it("shows a report without confirming it", () => {
    const unpaid = state();
    expect(trackingOf(unpaid)).toBe("unpaid");
    const withReport = state({ reports: [{ id: OBLIGATION_ID, envelope: {} as never, payload: reported, reportedAt: reported.reportedAt }] });
    expect(trackingOf(withReport)).toBe("payment_reported");
    expect(confirmedTotal(withReport)).toBe(0n);
  });

  it("uses only the latest cumulative confirmation", () => {
    const one = state({ confirmations: [
      { id: OBLIGATION_ID, envelope: {} as never, payload: partial, confirmedAt: partial.confirmedAt },
      { id: REQUEST_ID, envelope: {} as never, payload: full, confirmedAt: full.confirmedAt },
    ] });
    expect(confirmedTotal(one)).toBe(1200n);
    expect(trackingOf(one)).toBe("confirmed_by_organiser");
    expect(latestConfirmation(one)?.payload.outcome).toBe("confirmed_by_organiser");
  });

  it("keeps a confirmed payment visible after expiry and refuses to cancel a revoked request", () => {
    const expired = state({
      lifecycle: "expired",
      confirmations: [{ id: REQUEST_ID, envelope: {} as never, payload: full, confirmedAt: full.confirmedAt }],
    });
    expect(trackingOf(expired)).toBe("confirmed_by_organiser");
    expect(lifecycleOf(expired, Date.parse(EXPIRES) + 1)).toBe("expired");
    expect(lifecycleOf({ ...expired, revoked: true }, Date.parse(EXPIRES) + 1)).toBe("revoked");
    expect(lifecycleOf({ ...expired, lifecycle: "cancelled" }, Date.parse(EXPIRES) + 1)).toBe("cancelled");
    expect(lifecycleOf(expired, Date.parse(CREATED))).toBe("active");
  });

  it("summarises the request without leaking receipt text", () => {
    const summary = requestSummary(state({
      confirmations: [{ id: REQUEST_ID, envelope: {} as never, payload: partial, confirmedAt: partial.confirmedAt }],
    }), Date.parse(CREATED));
    expect(summary).toEqual({
      requestId: REQUEST_ID, obligationId: OBLIGATION_ID, participantLabel: "Alice",
      amountZatoshis: "1200", confirmedZatoshis: "600", tracking: "partially_confirmed",
      lifecycle: "active", expiresAt: EXPIRES, reports: 0, confirmations: 1,
    });
    expect(JSON.stringify(summary)).not.toContain("Fries");
  });
});

describe("pinned signing key conversion", () => {
  it("round trips a P-256 public key as raw x||y", async () => {
    const keys = await generateSigningKeys();
    const raw = rawPublicKey(keys.publicKey);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(publicKeyFromRaw(raw)).toEqual({ kty: "EC", crv: "P-256", x: keys.publicKey.x, y: keys.publicKey.y });
  });

  it("rejects wrong sizes, wrong curves and non-canonical encodings", () => {
    expect(() => publicKeyFromRaw("A".repeat(85))).toThrow(/pinned signing key/);
    expect(() => publicKeyFromRaw(`${"A".repeat(86)}=`)).toThrow(/pinned signing key/);
    expect(() => rawPublicKey({ kty: "RSA", n: "x", e: "AQAB" })).toThrow(/pinned signing key/);
    expect(() => rawPublicKey({ kty: "EC", crv: "P-256", x: encodeBase64Url(new Uint8Array(31)), y: encodeBase64Url(new Uint8Array(32)) }))
      .toThrow(/pinned signing key/);
  });
});

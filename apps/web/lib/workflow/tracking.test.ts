import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  evaluateDetailedTracking,
  evaluateObligations,
  evaluateArchiveWarning,
  evaluateBillTracking,
} from "./tracking";
import type { RequestState } from "../requests/types";
import type { LocalBill } from "../bills/types";
import { manifestFixture, NOW, TESTNET_SAPLING } from "../requests/__tests__/fixtures";
import { installCrypto } from "../private-workspace/test-support";

beforeEach(() => installCrypto());
afterEach(() => vi.unstubAllGlobals());

function mockRequestState(overrides: Partial<RequestState> = {}): RequestState {
  return {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    billId: "22222222-2222-4222-8222-222222222222",
    role: "organiser",
    payload: {
      payload: {
        version: 1,
        requestId: "11111111-1111-4111-8111-111111111111",
        obligationId: "33333333-3333-4333-8333-333333333333",
        reference: "splyt-0123456789abcdef0123456789abcdef",
        participantLabel: "Bob",
        amountZatoshis: "100000000",
        address: TESTNET_SAPLING,
        network: "testnet",
        createdAt: "2026-03-01T10:00:00.000Z",
        expiresAt: "2026-03-15T10:00:00.000Z",
        disclosure: "share-with-items",
        receipt: {
          title: "Dinner",
          currency: "USD",
          scale: 2,
          shareMinor: "1000",
          subtotalMinor: "1000",
          taxMinor: "0",
          tipMinor: "0",
          discountMinor: "0",
          itemsTotalMinor: null,
          receiptTotalMinor: null,
          items: null,
        },
        organiserNote: null,
      },
      signature: "dummy-sig",
    },
    pinnedPublicKey: "dummy-key",
    contentKey: "dummy-content-key",
    revision: 1,
    reports: [],
    confirmations: [],
    revoked: false,
    retainedUntil: "2026-04-01T10:00:00.000Z",
    lifecycle: "active",
    lastSyncedAt: NOW,
    ...overrides,
  };
}

describe("tracking workflow", () => {
  it("tracks unpaid state correctly", () => {
    const state = mockRequestState();
    const details = evaluateDetailedTracking(state);

    expect(details.tracking).toBe("unpaid");
    expect(details.isFullyPaid).toBe(false);
    expect(details.isPartiallyPaid).toBe(false);
    expect(details.isOverpaid).toBe(false);
    expect(details.remainingZatoshis).toBe("100000000");
  });

  it("identifies payment reported with unresolved report", () => {
    const state = mockRequestState({
      reports: [
        {
          id: "rep-1",
          envelope: { version: 1, kind: "report", recordId: "rep-1", revision: 2, nonce: "n", ciphertext: "c" },
          reportedAt: "2026-03-02T10:00:00.000Z",
          payload: {
            version: 1,
            requestId: "11111111-1111-4111-8111-111111111111",
            obligationId: "33333333-3333-4333-8333-333333333333",
            claimedZatoshis: "100000000",
            reportedAt: "2026-03-02T10:00:00.000Z",
            reference: null,
            note: null,
          },
        },
      ],
    });

    const details = evaluateDetailedTracking(state);
    expect(details.tracking).toBe("payment_reported");
    expect(details.hasUnresolvedReport).toBe(true);
    expect(details.isFullyPaid).toBe(false);
  });

  it("calculates partial payment, overpayment, and corrections", () => {
    // Partial payment
    const partialState = mockRequestState({
      confirmations: [
        {
          id: "conf-1",
          envelope: { version: 1, kind: "confirmation", recordId: "conf-1", revision: 2, nonce: "n", ciphertext: "c" },
          confirmedAt: "2026-03-03T10:00:00.000Z",
          payload: {
            version: 1,
            requestId: "11111111-1111-4111-8111-111111111111",
            obligationId: "33333333-3333-4333-8333-333333333333",
            receivedTotalZatoshis: "40000000",
            outcome: "partially_confirmed",
            confirmedAt: "2026-03-03T10:00:00.000Z",
            note: null,
            correctionReason: null,
            previousConfirmationId: null,
          },
        },
      ],
    });
    const partial = evaluateDetailedTracking(partialState);
    expect(partial.tracking).toBe("partially_confirmed");
    expect(partial.isPartiallyPaid).toBe(true);
    expect(partial.remainingZatoshis).toBe("60000000");

    // Overpayment with correction
    const overpaidState = mockRequestState({
      confirmations: [
        ...partialState.confirmations,
        {
          id: "conf-2",
          envelope: { version: 1, kind: "confirmation", recordId: "conf-2", revision: 3, nonce: "n", ciphertext: "c" },
          confirmedAt: "2026-03-04T10:00:00.000Z",
          payload: {
            version: 1,
            requestId: "11111111-1111-4111-8111-111111111111",
            obligationId: "33333333-3333-4333-8333-333333333333",
            receivedTotalZatoshis: "120000000",
            outcome: "correction",
            confirmedAt: "2026-03-04T10:00:00.000Z",
            note: "Corrected receipt",
            correctionReason: "Participant sent extra",
            previousConfirmationId: "conf-1",
          },
        },
      ],
    });
    const overpaid = evaluateDetailedTracking(overpaidState);
    expect(overpaid.tracking).toBe("confirmed_by_organiser");
    expect(overpaid.isFullyPaid).toBe(true);
    expect(overpaid.isOverpaid).toBe(true);
    expect(overpaid.overpaidZatoshis).toBe("20000000");
    expect(overpaid.hasCorrection).toBe(true);
    expect(overpaid.correctionHistory).toHaveLength(1);
  });

  it("detects late payments when report/confirmation occurs after expiry", () => {
    const expiredState = mockRequestState({
      reports: [
        {
          id: "rep-late",
          envelope: { version: 1, kind: "report", recordId: "rep-late", revision: 2, nonce: "n", ciphertext: "c" },
          reportedAt: "2026-03-20T10:00:00.000Z", // expiresAt was 2026-03-15
          payload: {
            version: 1,
            requestId: "11111111-1111-4111-8111-111111111111",
            obligationId: "33333333-3333-4333-8333-333333333333",
            claimedZatoshis: "100000000",
            reportedAt: "2026-03-20T10:00:00.000Z",
            reference: null,
            note: null,
          },
        },
      ],
    });

    const details = evaluateDetailedTracking(expiredState, Date.parse("2026-03-21T10:00:00.000Z"));
    expect(details.isLatePayment).toBe(true);
    expect(details.lifecycle).toBe("expired");
  });

  it("evaluates obligations and archive warnings", async () => {
    const manifest = await manifestFixture();
    const reqState = mockRequestState();

    const obligations = evaluateObligations(manifest, [reqState]);
    expect(obligations.length).toBeGreaterThan(0);

    // Warning evaluation
    const warningSoon = evaluateArchiveWarning("2026-03-05T10:00:00.000Z", false, Date.parse("2026-03-01T10:00:00.000Z"));
    expect(warningSoon.isExpiringSoon).toBe(true);
    expect(warningSoon.warningMessage).toContain("expires in 4 days");

    const localBill: LocalBill = {
      version: 1,
      contentKey: "k",
      revision: 1,
      retainedUntil: "2026-04-01T10:00:00.000Z",
      manifest,
    };
    const summary = evaluateBillTracking(localBill, [reqState], Date.parse("2026-03-01T10:00:00.000Z"));
    expect(summary.totalZatoshis).toBe("100000000");
    expect(summary.isFullySettled).toBe(false);
  });

  it.each([false, true])("does not let one overpayment settle another allocation (other request published: %s)", async (otherPublished) => {
    const manifest = await manifestFixture();
    manifest.participants[0].isOrganiser = false;
    manifest.allocations[0].isOrganiser = false;
    const paid = mockRequestState();
    paid.confirmations = [{
      id: "confirmation", confirmedAt: NOW,
      envelope: { version: 1, kind: "confirmation", recordId: "confirmation", revision: 2, nonce: "n", ciphertext: "c" },
      payload: {
        version: 1, requestId: paid.requestId, obligationId: paid.payload.payload.obligationId,
        receivedTotalZatoshis: "200000000", outcome: "confirmed_by_organiser", confirmedAt: NOW,
        note: null, correctionReason: null, previousConfirmationId: null,
      },
    }];
    const unpaid = mockRequestState({
      requestId: "44444444-4444-4444-8444-444444444444",
      payload: { ...paid.payload, payload: {
        ...paid.payload.payload,
        requestId: "44444444-4444-4444-8444-444444444444",
        obligationId: "55555555-5555-4555-8555-555555555555",
      } },
    });
    const states = otherPublished ? [paid, unpaid] : [paid];
    manifest.requests = states.map((state, index) => ({
      requestId: state.requestId, obligationId: state.payload.payload.obligationId,
      participantId: manifest.participants[index === 0 ? 1 : 0].id,
      participantLabel: state.payload.payload.participantLabel, reference: state.payload.payload.reference,
      contentKey: "test-key", readCapability: "test-read", reportCapability: "test-report",
      amountZatoshis: "100000000", address: TESTNET_SAPLING, network: "testnet",
      createdAt: NOW, expiresAt: state.payload.payload.expiresAt, publishedAt: NOW,
      revokedAt: null, lifecycle: "active", replacementFor: null, replacedBy: null,
    }));
    const bill: LocalBill = { version: 1, contentKey: "test-key", revision: 1, retainedUntil: null, manifest };
    const summary = evaluateBillTracking(bill, states, Date.parse(NOW));
    expect(summary.totalZatoshis).toBe("200000000");
    expect(summary.totalConfirmedZatoshis).toBe("200000000");
    expect(summary.totalRemainingZatoshis).toBe("100000000");
    expect(summary.isFullySettled).toBe(false);
  });
});

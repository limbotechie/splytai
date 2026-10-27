/**
 * Request tracking and lifecycle domain logic.
 *
 * Implements:
 *   - Strict separation of payment tracking vs request lifecycle
 *   - Partial and over-payment calculations
 *   - Confirmation corrections tracking
 *   - Replacement obligation resolution across replaced/revoked requests
 *   - Late payment detection (reported or confirmed after request expiry)
 *   - Archive warnings and retention expiry notices
 */

import type { BillManifest, LocalBill, RequestLifecycle, TrackingState } from "../bills/types";
import type { ConfirmationRecord, ReportRecord, RequestState } from "../requests/types";
import { trackingOf, lifecycleOf, latestConfirmation } from "../requests/payload";

export interface DetailedTracking {
  requestId: string;
  obligationId: string;
  participantLabel: string;
  amountZatoshis: string;
  receivedTotalZatoshis: string;
  tracking: TrackingState;
  lifecycle: RequestLifecycle;
  isFullyPaid: boolean;
  isPartiallyPaid: boolean;
  isOverpaid: boolean;
  overpaidZatoshis: string;
  remainingZatoshis: string;
  latestReport: ReportRecord | null;
  latestConfirmation: ConfirmationRecord | null;
  hasUnresolvedReport: boolean;
  isLatePayment: boolean;
  hasCorrection: boolean;
  correctionHistory: ConfirmationRecord[];
}

export interface ObligationTracking {
  obligationId: string;
  participantId: string;
  participantLabel: string;
  targetAmountZatoshis: string;
  requests: RequestState[];
  activeRequest: RequestState | null;
  cumulativeConfirmedZatoshis: string;
  isFulfilled: boolean;
  hasPendingReport: boolean;
}

export interface ArchiveWarning {
  isArchived: boolean;
  retainedUntil: string | null;
  daysUntilRetentionExpiry: number | null;
  isExpiringSoon: boolean;
  warningMessage: string | null;
}

export interface BillTrackingSummary {
  billId: string;
  title: string;
  totalZatoshis: string;
  totalConfirmedZatoshis: string;
  totalClaimedZatoshis: string;
  totalRemainingZatoshis: string;
  isFullySettled: boolean;
  obligations: ObligationTracking[];
  archiveWarning: ArchiveWarning;
}

/**
 * Evaluates detailed tracking for one request state.
 */
export function evaluateDetailedTracking(state: RequestState, now = Date.now()): DetailedTracking {
  const reqAmount = BigInt(state.payload.payload.amountZatoshis);
  const latestConf = latestConfirmation(state) ?? null;
  const receivedTotal = latestConf ? BigInt(latestConf.payload.receivedTotalZatoshis) : 0n;

  const isFullyPaid = receivedTotal >= reqAmount;
  const isPartiallyPaid = receivedTotal > 0n && receivedTotal < reqAmount;
  const isOverpaid = receivedTotal > reqAmount;
  const overpaidZatoshis = isOverpaid ? (receivedTotal - reqAmount).toString() : "0";
  const remainingZatoshis = isFullyPaid ? "0" : (reqAmount - receivedTotal).toString();

  const sortedReports = [...state.reports].sort((a, b) =>
    a.reportedAt < b.reportedAt ? -1 : a.reportedAt > b.reportedAt ? 1 : 0,
  );
  const latestReport = sortedReports.at(-1) ?? null;

  // An unresolved report is any report submitted after the latest confirmation
  const hasUnresolvedReport = Boolean(
    latestReport && (!latestConf || latestReport.reportedAt > latestConf.confirmedAt),
  );

  // Late payment: any report or confirmation occurring after expiresAt
  const expiresAtMs = Date.parse(state.payload.payload.expiresAt);
  const isLateReport = latestReport ? Date.parse(latestReport.reportedAt) > expiresAtMs : false;
  const isLateConf = latestConf ? Date.parse(latestConf.confirmedAt) > expiresAtMs : false;
  const isLatePayment = isLateReport || isLateConf;

  // Correction tracking
  const correctionHistory = state.confirmations.filter((c) => c.payload.outcome === "correction");
  const hasCorrection = correctionHistory.length > 0;

  return {
    requestId: state.requestId,
    obligationId: state.payload.payload.obligationId,
    participantLabel: state.payload.payload.participantLabel,
    amountZatoshis: state.payload.payload.amountZatoshis,
    receivedTotalZatoshis: receivedTotal.toString(),
    tracking: trackingOf(state),
    lifecycle: lifecycleOf(state, now),
    isFullyPaid,
    isPartiallyPaid,
    isOverpaid,
    overpaidZatoshis,
    remainingZatoshis,
    latestReport,
    latestConfirmation: latestConf,
    hasUnresolvedReport,
    isLatePayment,
    hasCorrection,
    correctionHistory,
  };
}

/**
 * Resolves obligations across replacement chains.
 * Multiple requests with the same obligationId represent successive versions of
 * the participant's obligation.
 */
export function evaluateObligations(
  manifest: BillManifest,
  requestStates: RequestState[],
  now = Date.now(),
): ObligationTracking[] {
  const statesByObligation = new Map<string, RequestState[]>();
  for (const s of requestStates) {
    const obId = s.payload.payload.obligationId;
    const existing = statesByObligation.get(obId) ?? [];
    existing.push(s);
    statesByObligation.set(obId, existing);
  }

  // Also include obligations from manifest that might not have a RequestState yet
  const inventoryByObligation = new Map<string, typeof manifest.requests[0]>();
  for (const req of manifest.requests) {
    inventoryByObligation.set(req.obligationId, req);
  }

  const allObligationIds = Array.from(
    new Set([...statesByObligation.keys(), ...inventoryByObligation.keys()]),
  );

  return allObligationIds.map((obId) => {
    const states = statesByObligation.get(obId) ?? [];
    const inv = inventoryByObligation.get(obId);

    const participantId = inv?.participantId ?? "unknown";
    const participantLabel = inv?.participantLabel ?? states[0]?.payload.payload.participantLabel ?? "Participant";
    const targetAmountZatoshis = inv?.amountZatoshis ?? states[0]?.payload.payload.amountZatoshis ?? "0";

    // Active request is one that is active according to lifecycle
    const activeRequest = states.find((s) => lifecycleOf(s, now) === "active") ?? null;

    // Cumulative confirmed zatoshis is the maximum confirmed on any request for this obligation,
    // or sum of latest confirmations
    let maxConfirmed = 0n;
    let hasPendingReport = false;

    for (const s of states) {
      const details = evaluateDetailedTracking(s, now);
      const conf = BigInt(details.receivedTotalZatoshis);
      if (conf > maxConfirmed) {
        maxConfirmed = conf;
      }
      if (details.hasUnresolvedReport) {
        hasPendingReport = true;
      }
    }

    const isFulfilled = maxConfirmed >= BigInt(targetAmountZatoshis) && BigInt(targetAmountZatoshis) > 0n;

    return {
      obligationId: obId,
      participantId,
      participantLabel,
      targetAmountZatoshis,
      requests: states,
      activeRequest,
      cumulativeConfirmedZatoshis: maxConfirmed.toString(),
      isFulfilled,
      hasPendingReport,
    };
  });
}

/**
 * Checks if a bill or workspace record is approaching its relay retention date.
 */
export function evaluateArchiveWarning(
  retainedUntil: string | null,
  isArchived: boolean,
  now = Date.now(),
  warningThresholdDays = 7,
): ArchiveWarning {
  if (!retainedUntil) {
    return {
      isArchived,
      retainedUntil: null,
      daysUntilRetentionExpiry: null,
      isExpiringSoon: false,
      warningMessage: isArchived ? "This bill is archived." : null,
    };
  }
  const retainedMs = Date.parse(retainedUntil);
  const diffMs = retainedMs - now;
  const daysUntilRetentionExpiry = Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
  const isExpiringSoon = daysUntilRetentionExpiry <= warningThresholdDays;

  let warningMessage: string | null = null;
  if (diffMs <= 0) {
    warningMessage = "Relay retention period has expired. This bill may be purged from the relay at any time.";
  } else if (isExpiringSoon) {
    warningMessage = `Relay retention expires in ${daysUntilRetentionExpiry} day${daysUntilRetentionExpiry === 1 ? "" : "s"}. Export your workspace backup or renew if needed.`;
  } else if (isArchived) {
    warningMessage = "This bill is archived.";
  }

  return {
    isArchived,
    retainedUntil,
    daysUntilRetentionExpiry,
    isExpiringSoon,
    warningMessage,
  };
}

/**
 * Computes an overall tracking summary for a local bill and its requests.
 */
export function evaluateBillTracking(
  bill: LocalBill,
  requestStates: RequestState[],
  now = Date.now(),
): BillTrackingSummary {
  const manifest = bill.manifest;
  const obligations = evaluateObligations(manifest, requestStates, now);

  let totalZatoshis = 0n;
  for (const alloc of manifest.allocations) {
    if (!alloc.isOrganiser) {
      totalZatoshis += BigInt(alloc.zatoshis);
    }
  }

  let totalConfirmedZatoshis = 0n;
  let totalClaimedZatoshis = 0n;

  for (const ob of obligations) {
    totalConfirmedZatoshis += BigInt(ob.cumulativeConfirmedZatoshis);
    for (const req of ob.requests) {
      for (const rep of req.reports) {
        totalClaimedZatoshis += BigInt(rep.payload.claimedZatoshis);
      }
    }
  }

  let remaining = 0n;
  for (const allocation of manifest.allocations.filter((entry) => !entry.isOrganiser)) {
    const amount = BigInt(allocation.zatoshis);
    const credited = obligations.filter((entry) => entry.participantId === allocation.participantId)
      .reduce((total, entry) => {
        const confirmed = BigInt(entry.cumulativeConfirmedZatoshis);
        const target = BigInt(entry.targetAmountZatoshis);
        return total + (confirmed > target ? target : confirmed);
      }, 0n);
    remaining += amount > credited ? amount - credited : 0n;
  }
  const isFullySettled = totalZatoshis > 0n && remaining === 0n && obligations.every((entry) => entry.isFulfilled);

  const isArchived = manifest.status === "archived";
  const archiveWarning = evaluateArchiveWarning(bill.retainedUntil, isArchived, now);

  return {
    billId: manifest.billId,
    title: manifest.title,
    totalZatoshis: totalZatoshis.toString(),
    totalConfirmedZatoshis: totalConfirmedZatoshis.toString(),
    totalClaimedZatoshis: totalClaimedZatoshis.toString(),
    totalRemainingZatoshis: remaining.toString(),
    isFullySettled,
    obligations,
    archiveWarning,
  };
}

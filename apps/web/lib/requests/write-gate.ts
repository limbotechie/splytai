import { isUuid, validateBillManifest } from "../bills/manifest";
import type { LocalBill } from "../bills/types";
import { hasExactKeys, isTimestamp } from "../private-workspace/format";
import { readRecord, writeRecord } from "../private-workspace/storage";
import { recoveryMetadata } from "../private-workspace/recovery";
import { latestConfirmation } from "./payload";
import type { RequestState } from "./types";

/**
 * A local acknowledgement that this browser has read the relay for the bill.
 * It authorises local writes only while it is recent and only when it was made
 * after the workspace was restored from a recovery file.
 */
export interface ReconciliationReceipt {
  version: 1;
  billId: string;
  revision: number;
  reconciledAt: string;
}

export const MAX_RECONCILIATION_AGE_MS = 10 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const PREFIX = "sync:";

export function reconciliationRecordId(billId: string): string {
  if (!isUuid(billId)) throw new Error("The bill identifier is invalid.");
  return `${PREFIX}${billId}`;
}

export function parseReconciliationReceipt(value: unknown): ReconciliationReceipt {
  if (!hasExactKeys(value, ["version", "billId", "revision", "reconciledAt"])) {
    throw new Error("The reconciliation record is invalid.");
  }
  if (value.version !== 1 || !isUuid(value.billId)) throw new Error("The reconciliation record is invalid.");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw new Error("The reconciliation record is invalid.");
  if (!isTimestamp(value.reconciledAt)) throw new Error("The reconciliation record is invalid.");
  return {
    version: 1,
    billId: value.billId,
    revision: value.revision as number,
    reconciledAt: value.reconciledAt,
  };
}

export interface WriteGateOptions {
  now?: string | number;
  /** From `recoveryMetadata()`; a restored workspace must reconcile again. */
  restoredAt?: string | null;
}

function clock(value: string | number | undefined): number {
  if (value === undefined) return Date.now();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && isTimestamp(value)) return Date.parse(value);
  throw new Error("The write-gate time is invalid.");
}

/**
 * Pure decision. A bill is writable when:
 * - a receipt exists for this bill and describes a revision this browser has
 *   not fallen behind (a receipt from a newer revision means a rollback);
 * - the receipt is still fresh; and
 * - if the workspace was restored, the receipt was made after that restore.
 */
export function reconciliationSatisfied(
  bill: Pick<LocalBill, "revision" | "manifest">,
  receipt: unknown,
  options: WriteGateOptions = {},
): boolean {
  try {
    if (!Number.isSafeInteger(bill.revision) || bill.revision < 0) return false;
    if (!isUuid(bill.manifest?.billId)) return false;
    const checked = parseReconciliationReceipt(receipt);
    if (checked.billId !== bill.manifest.billId) return false;
    if (checked.revision > bill.revision) return false;
    const now = clock(options.now);
    const reconciledAt = Date.parse(checked.reconciledAt);
    if (reconciledAt > now + MAX_CLOCK_SKEW_MS) return false;
    if (now - reconciledAt > MAX_RECONCILIATION_AGE_MS) return false;
    if (options.restoredAt !== undefined && options.restoredAt !== null) {
      if (!isTimestamp(options.restoredAt)) return false;
      if (reconciledAt <= Date.parse(options.restoredAt)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function assertBillWritable(
  bill: Pick<LocalBill, "revision" | "manifest">,
  receipt: unknown,
  options: WriteGateOptions = {},
): void {
  if (reconciliationSatisfied(bill, receipt, options)) return;
  if (options.restoredAt) {
    throw new Error("This workspace was restored from a backup. Reconcile this bill with the relay before changing it.");
  }
  throw new Error("Reconcile this bill with the relay before changing it; the last check is missing, stale, or from another revision.");
}

export async function readReconciliation(billId: string): Promise<ReconciliationReceipt | null> {
  const record = await readRecord<unknown>(reconciliationRecordId(billId));
  return record ? parseReconciliationReceipt(record.value) : null;
}

/**
 * Records the result of a successful relay reconciliation. Concurrent tabs may
 * both observe the same revision; the retry re-reads the revision rather than
 * overwriting a newer receipt.
 */
export async function recordReconciliation(
  bill: Pick<LocalBill, "revision" | "manifest">,
  reconciledAt = new Date().toISOString(),
): Promise<ReconciliationReceipt> {
  validateBillManifest(bill.manifest, bill.manifest.billId);
  if (!Number.isSafeInteger(bill.revision) || bill.revision < 0) throw new Error("The bill revision is invalid.");
  const receipt = parseReconciliationReceipt({
    version: 1,
    billId: bill.manifest.billId,
    revision: bill.revision,
    reconciledAt,
  });
  const id = reconciliationRecordId(bill.manifest.billId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await readRecord<unknown>(id);
    try {
      await writeRecord(id, receipt, existing ? existing.revision : null);
      return receipt;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("The reconciliation record could not be saved.");
}

/** Reads both the receipt and the restore guard, then applies the gate. */
export async function requireWritableBill(
  bill: Pick<LocalBill, "revision" | "manifest">,
  now = new Date().toISOString(),
): Promise<void> {
  const [receipt, metadata] = await Promise.all([
    readReconciliation(bill.manifest.billId),
    recoveryMetadata(),
  ]);
  assertBillWritable(bill, receipt, { now, restoredAt: metadata.restoredAt });
}

/**
 * A participant report is unresolved until an organiser confirmation recorded at
 * or after it exists. Unresolved reports block economic amendments.
 */
export function hasUnresolvedReport(state: Pick<RequestState, "reports" | "confirmations">): boolean {
  if (!state.reports.length) return false;
  const latest = latestConfirmation(state);
  if (!latest) return true;
  return state.reports.some((report) => Date.parse(report.reportedAt) > Date.parse(latest.confirmedAt) ||
    (report.reportedAt === latest.confirmedAt && report.id > latest.id));
}

export function assertEconomicAmendmentAllowed(
  states: Pick<RequestState, "reports" | "confirmations">[],
): void {
  if (!Array.isArray(states)) throw new Error("The request inventory is invalid.");
  if (states.some(hasUnresolvedReport)) {
    throw new Error("Resolve every participant payment report before changing amounts, recipients, or the receiving address.");
  }
}

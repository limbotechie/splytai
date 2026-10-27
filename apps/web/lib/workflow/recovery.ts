/**
 * Workspace recovery and lifecycle management.
 *
 * Implements:
 *   - Encrypted backup export and import
 *   - Restored workspace reconciliation with write gate (sync after restore)
 *   - Local workspace clear (purging browser IndexedDB)
 *   - Authenticated remote deletion (deleting bills on relay using edit capabilities,
 *     then purging local records)
 *   - Backup coverage and status inspection
 */

import {
  exportWorkspace,
  importWorkspace,
  recoveryMetadata,
  recoveryStatus,
} from "../private-workspace/recovery";
import { clearWorkspace } from "../private-workspace/storage";
import {
  listLocalBills,
  readEditCapability,
  syncBill,
  deleteBill,
} from "./bill";
import { syncBillRequests, listLocalRequests } from "./request";
import { listParticipantInvites, syncParticipantRequest } from "./participant";
import type { RelayClient } from "../requests/relay";

export interface WorkspaceReconciliationResult {
  reconciledBills: string[];
  reconciledRequests: string[];
  failedBills: { billId: string; error: string }[];
  failedRequests: { requestId: string; error: string }[];
}

export interface ImportWorkspaceResult {
  success: boolean;
  reconciliation: WorkspaceReconciliationResult | null;
}

/**
 * Creates an encrypted export of the current local workspace.
 */
export async function exportEncryptedWorkspace(passphrase: string): Promise<string> {
  return exportWorkspace(passphrase);
}

/**
 * Reconciles all restored bills and requests with the relay to refresh
 * the write-gate reconciliation receipts after a backup import.
 */
export async function reconcileRestoredWorkspace(
  relay: RelayClient,
  now = new Date().toISOString(),
): Promise<WorkspaceReconciliationResult> {
  const result: WorkspaceReconciliationResult = {
    reconciledBills: [],
    reconciledRequests: [],
    failedBills: [],
    failedRequests: [],
  };

  // 1. Reconcile organiser bills
  const localBills = await listLocalBills();
  const allRequests = await listLocalRequests();

  for (const billRecord of localBills) {
    const billId = billRecord.value.manifest.billId;
    const editCap = await readEditCapability(billId);
    if (!editCap) {
      result.failedBills.push({ billId, error: "The organiser edit capability is missing. This bill could not be reconciled." });
      continue;
    }

    try {
      // Sync the bill manifest and obtain fresh reconciliation receipt
      const synced = await syncBill(relay, billRecord, now);

      // Reconcile associated requests
      const billRequests = allRequests
        .filter((r) => r.value.billId === billId)
        .map((r) => r.value);

      const syncedReqs = await syncBillRequests(relay, {
        id: billRecord.id,
        revision: synced.localRevision,
        value: synced.bill,
      }, billRequests, now);

      result.reconciledBills.push(billId);
      for (const req of syncedReqs.requests) {
        result.reconciledRequests.push(req.requestId);
      }
      for (const requestId of syncedReqs.missingRequestIds) {
        result.failedRequests.push({ requestId, error: "The relay request was unavailable during reconciliation." });
      }
    } catch (err: unknown) {
      result.failedBills.push({
        billId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Reconcile participant requests
  const participantInvites = await listParticipantInvites();
  for (const inviteRecord of participantInvites) {
    const requestId = inviteRecord.value.requestId;
    try {
      await syncParticipantRequest(relay, requestId, now);
      result.reconciledRequests.push(requestId);
    } catch (err: unknown) {
      result.failedRequests.push({
        requestId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/**
 * Imports an encrypted recovery file into the local workspace.
 * If a relay client is supplied, automatically reconciles all restored records
 * to satisfy the write gate.
 */
export async function importEncryptedWorkspace(
  backupText: string,
  passphrase: string,
  relay?: RelayClient,
  now?: string,
): Promise<ImportWorkspaceResult> {
  await importWorkspace(backupText, passphrase);

  let reconciliation: WorkspaceReconciliationResult | null = null;
  if (relay) {
    reconciliation = await reconcileRestoredWorkspace(relay, now ?? new Date().toISOString());
  }

  return {
    success: reconciliation === null || (reconciliation.failedBills.length === 0 && reconciliation.failedRequests.length === 0),
    reconciliation,
  };
}

/**
 * Completely clears the local private workspace in this browser.
 * Does not touch the relay.
 */
export async function clearLocalWorkspaceOnly(): Promise<void> {
  await clearWorkspace();
}

/**
 * Deletes all bills on the relay for which this workspace possesses edit capabilities,
 * then purges the local workspace.
 */
export async function deleteWorkspaceAndRelayData(
  relay: RelayClient,
  now = new Date().toISOString(),
): Promise<{ deletedBills: string[]; failedBills: { billId: string; error: string }[] }> {
  const deletedBills: string[] = [];
  const failedBills: { billId: string; error: string }[] = [];

  const localBills = await listLocalBills();
  for (const billRecord of localBills) {
    const billId = billRecord.value.manifest.billId;
    const editCap = await readEditCapability(billId);
    if (!editCap) {
      failedBills.push({ billId, error: "The organiser edit capability is missing. Remote deletion was not performed." });
      continue;
    }

    try {
      // First sync to satisfy write gate
      const synced = await syncBill(relay, billRecord, now);
      await deleteBill(relay, {
        id: billRecord.id,
        revision: synced.localRevision,
        value: synced.bill,
      }, now);
      deletedBills.push(billId);
    } catch (err: unknown) {
      failedBills.push({
        billId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Preserve keys and records needed to retry any failed remote deletion.
  if (failedBills.length === 0) await clearWorkspace();

  return {
    deletedBills,
    failedBills,
  };
}

/**
 * Inspects backup status, coverage, and restoration state.
 */
export async function getWorkspaceRecoveryStatus(): Promise<{
  lastExportAt: string | null;
  uncoveredRecords: number;
  restoredAt: string | null;
  requiresRemoteRefresh: boolean;
}> {
  const status = await recoveryStatus();
  const meta = await recoveryMetadata();
  return {
    lastExportAt: status.lastExportAt,
    uncoveredRecords: status.uncoveredRecords,
    restoredAt: meta.restoredAt,
    requiresRemoteRefresh: meta.requiresRemoteRefresh,
  };
}

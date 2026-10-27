"use client";

import { useState } from "react";
import {
  Download,
  Upload,
  Trash2,
  ShieldCheck,
  AlertTriangle,
  Globe,
  Database,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  exportEncryptedWorkspace,
  importEncryptedWorkspace,
  clearLocalWorkspaceOnly,
  deleteWorkspaceAndRelayData,
  reconcileRestoredWorkspace,
  type WorkspaceReconciliationResult,
} from "@/lib/workflow/recovery";
import {
  Panel,
  PageHeader,
  Pill,
  actionClass,
} from "@/components/app/common/Primitives";

export default function SettingsPage() {
  const { relay, status, refreshStatus, isSupported, relayConnection, refreshRelay } =
    useWorkspace();

  // Export state
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  // Import state
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);

  // Danger state
  const [isClearing, setIsClearing] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [dangerError, setDangerError] = useState<string | null>(null);
  const [dangerSuccess, setDangerSuccess] = useState<string | null>(null);

  const showReconciliation = (result: WorkspaceReconciliationResult | null) => {
    const failures = [...(result?.failedBills ?? []), ...(result?.failedRequests ?? [])];
    if (!result || failures.length) {
      setImportSuccess(null);
      setNeedsReconciliation(true);
      setImportError(`The backup was restored locally, but ${failures.length ? `${failures.length} record(s) could not be reconciled` : "relay reconciliation has not run"}. ${failures[0]?.error ?? "Check the relay configuration."} Retry reconciliation before making remote changes.`);
      return;
    }
    setNeedsReconciliation(false);
    setImportError(null);
    const count = result.reconciledBills.length + result.reconciledRequests.length;
    setImportSuccess(`Workspace restored and reconciled (${count} record${count === 1 ? "" : "s"} updated).`);
  };

  const handleReconcile = async () => {
    setIsImporting(true);
    setImportError(null);
    try {
      showReconciliation(await reconcileRestoredWorkspace(relay));
      await refreshStatus();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Reconciliation failed. Your restored local records are unchanged.");
    } finally {
      setIsImporting(false);
    }
  };

  const handleExport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportPassphrase || exportPassphrase.length < 8) {
      setExportError("Passphrase must be at least 8 characters long.");
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportSuccess(false);

    try {
      const backupJson = await exportEncryptedWorkspace(exportPassphrase);
      const blob = new Blob([backupJson], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `splyt-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setExportPassphrase("");
      await refreshStatus();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Failed to export workspace.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importFile) {
      setImportError("Please select a backup file to import.");
      return;
    }
    if (!importPassphrase) {
      setImportError("Please enter the decryption passphrase for this backup.");
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const text = await importFile.text();
      const result = await importEncryptedWorkspace(text, importPassphrase, relay);
      showReconciliation(result.reconciliation);
      setImportFile(null);
      setImportPassphrase("");
      await refreshStatus();
    } catch (err) {
      setImportError(
        err instanceof Error
          ? err.message
          : "Failed to import workspace. Ensure the passphrase is correct."
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleClearLocal = async () => {
    if (
      !window.confirm(
        "Clear this encrypted workspace? This removes its bills, encrypted drafts, invites, and encryption keys from this browser. Your relay envelopes and any separate legacy draft storage are not removed."
      )
    ) {
      return;
    }

    setIsClearing(true);
    setDangerError(null);
    setDangerSuccess(null);

    try {
      await clearLocalWorkspaceOnly();
      setDangerSuccess("Local workspace records successfully cleared.");
      await refreshStatus();
    } catch (err) {
      setDangerError(err instanceof Error ? err.message : "Failed to clear workspace.");
    } finally {
      setIsClearing(false);
    }
  };

  const handleDeleteAll = async () => {
    if (
      !window.confirm(
        "WARNING: Irreversible action. This will permanently delete all your hosted bills from the blind relay using your edit capabilities, then wipe all local records on this device. Proceed?"
      )
    ) {
      return;
    }

    setIsPurging(true);
    setDangerError(null);
    setDangerSuccess(null);

    try {
      const result = await deleteWorkspaceAndRelayData(relay);
      if (result.failedBills.length) {
        setDangerError(`Deletion is incomplete: ${result.deletedBills.length} hosted bill(s) deleted, ${result.failedBills.length} failed. Remaining local records are preserved for retry. ${result.failedBills[0].error}`);
      } else {
        setDangerSuccess(`Encrypted workspace cleared and ${result.deletedBills.length} hosted bill${result.deletedBills.length === 1 ? "" : "s"} deleted from the relay.`);
      }
      await refreshStatus();
    } catch (err) {
      setDangerError(err instanceof Error ? err.message : "Failed to delete all data.");
    } finally {
      setIsPurging(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-9 py-8 sm:py-12">
      <PageHeader
        eyebrow="Workspace & Settings"
        title={
          <>
            Manage your private workspace <span className="font-serif italic">and network.</span>
          </>
        }
        description="Manage client-side encryption keys, encrypted backups, and your testnet relay connection."
        action={
          <Pill tone={isSupported === null ? "neutral" : isSupported ? "success" : "danger"}>
            <Database size={13} /> {isSupported === null ? "Checking Storage" : isSupported ? "Encrypted Storage Available" : "Storage Unavailable"}
          </Pill>
        }
      />

      <div className="grid min-w-0 gap-6 lg:grid-cols-2 lg:gap-8">
        {/* Left Column: Network and Diagnostics */}
        <div className="min-w-0 space-y-6">
          {/* Network Preference */}
          <Panel className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Globe size={18} />
              </span>
              <Pill tone="info">
                Testnet Only
              </Pill>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-medium tracking-tight">Active Zcash Network</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Splyt operates exclusively on Zcash Testnet for shielded reimbursements and ZIP 321 handoffs.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div
                className="flex flex-col items-start gap-1 rounded-[20px] border border-primary bg-primary/5 p-4 text-left shadow-xs text-foreground"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-semibold">Testnet</span>
                  <span className="text-[10px] font-mono uppercase bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">Active</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  ztestsapling1 & utest1 shielded addresses
                </span>
              </div>

              <div
                className="flex flex-col items-start gap-1 rounded-[20px] border border-border/40 bg-muted/20 p-4 text-left opacity-60 cursor-not-allowed"
              >
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm font-semibold text-muted-foreground">Mainnet</span>
                  <span className="text-[10px] font-mono uppercase bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">Disabled</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  Mainnet is not supported in this release
                </span>
              </div>
            </div>

            <div className="rounded-[18px] bg-muted/40 p-3.5 text-xs text-muted-foreground">
              <p>
                <strong>Security note:</strong> Splyt strictly enforces shielded testnet addresses (<code className="font-mono">ztestsapling1</code> or <code className="font-mono">utest1</code>). Transparent
                addresses (<code className="font-mono">t1</code> / <code className="font-mono">t3</code>) are rejected to guarantee privacy.
              </p>
            </div>
          </Panel>

          {/* Privacy & Architecture Panel */}
          <Panel className="space-y-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-teal-500/10 text-teal-700 dark:text-teal-300">
              <ShieldCheck size={18} />
            </span>
            <h2 className="text-xl font-medium tracking-tight">
              Zero Plaintext on the Relay
            </h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              All receipt data, participant names, and allocations are encrypted in your browser using AES-GCM
              with ephemeral keys before leaving your device. The relay stores only blind ciphertext envelopes.
              Only participants with invite links hold the content keys to decrypt payment amounts.
            </p>
            <div className="space-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
              <div className="flex flex-wrap justify-between gap-2">
                <span>Relay endpoint</span>
                <span className="min-w-0 font-mono text-[11px] text-foreground [overflow-wrap:anywhere]">
                  {relay.baseUrl ?? "Not configured: NEXT_PUBLIC_RELAY_URL"}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>{relayConnection.status === "connected" ? "Relay connected" : relayConnection.status === "checking" ? "Checking relay" : relayConnection.status === "offline" ? "Relay offline" : "Relay not configured"}</span>
                <button type="button" onClick={refreshRelay} disabled={relayConnection.status === "checking"} className="text-primary hover:underline">Retry connection</button>
              </div>
              {relayConnection.error ? <p role="alert" className="text-destructive [overflow-wrap:anywhere]">{relayConnection.error}</p> : null}
              <div className="flex justify-between">
                <span>IndexedDB support</span>
                <span className="text-foreground">{isSupported === null ? "Checking" : isSupported ? "Available" : "Unavailable"}</span>
              </div>
              {status?.lastExportAt && (
                <div className="flex justify-between">
                  <span>Last backup export</span>
                  <span className="text-foreground">
                    {new Date(status.lastExportAt).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Right Column: Backup, Restore & Danger Zone */}
        <div className="min-w-0 space-y-6">
          {/* Backup Export */}
          <Panel className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Download size={18} />
              </span>
              <Pill tone={!status ? "neutral" : !status.lastExportAt || status.uncoveredRecords ? "warning" : "success"}>
                {!status ? "Backup Status Unavailable" : !status.lastExportAt ? "No Backup Exported" : status.uncoveredRecords
                  ? `${status.uncoveredRecords} Unbacked Changes`
                  : "Backup Up to Date"}
              </Pill>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-medium tracking-tight">Export Encrypted Backup</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Download an encrypted JSON snapshot containing your hosted bills, capabilities, and participant invites.
                Protected by a password of your choice.
              </p>
            </div>

            <form onSubmit={handleExport} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="export-passphrase"
                  className="text-xs font-medium text-foreground"
                >
                  Encryption Passphrase (min. 8 characters)
                </label>
                <input
                  id="export-passphrase"
                  type="password"
                  placeholder="Enter a strong passphrase"
                  value={exportPassphrase}
                  onChange={(e) => setExportPassphrase(e.target.value)}
                  className="h-11 w-full rounded-[18px] border border-border/70 bg-background/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {exportError && (
                <p className="text-xs text-destructive">{exportError}</p>
              )}
              {exportSuccess && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} /> Encrypted backup prepared. Check your browser&apos;s downloads.
                </p>
              )}

              <button
                type="submit"
                disabled={isExporting || exportPassphrase.length < 8}
                className={`${actionClass("primary")} w-full justify-center`}
              >
                {isExporting ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" /> Exporting...
                  </>
                ) : (
                  <>
                    <Download size={15} /> Download Encrypted Snapshot
                  </>
                )}
              </button>
            </form>
          </Panel>

          {/* Backup Import */}
          <Panel className="space-y-5">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload size={18} />
              </span>
              <Pill tone="neutral">Restore Workspace</Pill>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-medium tracking-tight">Import Encrypted Backup</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Restore previously exported bills and sync fresh write receipts with the relay.
              </p>
            </div>

            <form onSubmit={handleImport} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="import-file" className="text-xs font-medium text-foreground">
                  Select Backup JSON File
                </label>
                <input
                  id="import-file"
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/80"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="import-passphrase"
                  className="text-xs font-medium text-foreground"
                >
                  Decryption Passphrase
                </label>
                <input
                  id="import-passphrase"
                  type="password"
                  placeholder="Passphrase used when exporting"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  className="h-11 w-full rounded-[18px] border border-border/70 bg-background/50 px-4 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                />
              </div>

              {importError && (
                <p className="text-xs text-destructive">{importError}</p>
              )}
              {needsReconciliation ? <button type="button" disabled={isImporting} onClick={handleReconcile} className={`${actionClass("secondary")} w-full text-xs`}>Retry Relay Reconciliation</button> : null}
              {importSuccess && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} /> {importSuccess}
                </p>
              )}

              <button
                type="submit"
                disabled={isImporting || !importFile || !importPassphrase}
                className={`${actionClass("secondary")} w-full justify-center`}
              >
                {isImporting ? (
                  <>
                    <RefreshCw className="size-4 animate-spin" /> Importing & Reconciling...
                  </>
                ) : (
                  <>
                    <Upload size={15} /> Restore Workspace
                  </>
                )}
              </button>
            </form>
          </Panel>

          {/* Danger Zone */}
          <Panel className="space-y-5 border-destructive/20 bg-destructive/5">
            <div className="flex items-center justify-between">
              <span className="flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <AlertTriangle size={18} />
              </span>
              <Pill tone="danger">Danger Zone</Pill>
            </div>

            <div className="space-y-1">
              <h2 className="text-xl font-medium tracking-tight">Clear Workspace Data</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Manage local and remote data deletion. Ensure you have backed up any needed records first.
              </p>
            </div>

            {dangerError && <p className="text-xs text-destructive">{dangerError}</p>}
            {dangerSuccess && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={13} /> {dangerSuccess}
              </p>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleClearLocal}
                disabled={isClearing || isPurging}
                className="flex w-full items-center justify-between rounded-[18px] border border-border bg-background px-4 py-3 text-xs font-medium text-foreground transition hover:bg-muted"
              >
                <span>Clear Local Device Storage (Keeps Relay)</span>
                <Trash2 size={14} className="text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={handleDeleteAll}
                disabled={isClearing || isPurging}
                className="flex w-full items-center justify-between rounded-[18px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-xs font-semibold text-destructive transition hover:bg-destructive/20"
              >
                <span>Delete All Remote & Local Data (Irreversible)</span>
                <Trash2 size={14} className="text-destructive" />
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

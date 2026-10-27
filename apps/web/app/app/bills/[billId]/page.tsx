"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Lock,
  RefreshCw,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  Archive,
  AlertCircle,
  FileCheck,
} from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { billRecordId, archiveBill, deleteBill } from "@/lib/workflow/bill";
import {
  publishRequest,
  syncBillRequests,
  confirmPayment,
  readLocalRequest,
  listLocalRequests,
} from "@/lib/workflow/request";
import { evaluateDetailedTracking, evaluateBillTracking } from "@/lib/workflow/tracking";
import type { LocalBill } from "@/lib/bills/types";
import type { ConfirmationOutcome, RequestState } from "@/lib/requests/types";
import type { LocalRecord } from "@/lib/private-workspace/storage";
import { readRecord } from "@/lib/private-workspace/storage";
import { validateBillManifest } from "@/lib/bills/manifest";
import { formatDecimal, formatZec } from "@/lib/bills/money";
import { inviteUrl } from "@/lib/requests/invite";
import { Action, PageHeader, Panel, Pill, StatePanel, actionClass, fieldClass } from "@/components/app/common/Primitives";
import { AppDialog } from "@/components/app/common/AppDialog";

interface Props {
  params: Promise<{ billId: string }>;
}

export default function BillDetailPage({ params }: Props) {
  const { billId } = use(params);
  return <BillDetailContent key={billId} billId={billId} />;
}

function BillDetailContent({ billId }: { billId: string }) {
  const router = useRouter();
  const { relay, appUrl } = useWorkspace();

  const [billRecord, setBillRecord] = useState<LocalRecord<LocalBill> | null>(null);
  const [requests, setRequests] = useState<RequestState[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite modal state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [activeInviteUrl, setActiveInviteUrl] = useState<string | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Confirmation modal state
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<RequestState | null>(null);
  const [confirmZatoshis, setConfirmZatoshis] = useState("");
  const [confirmOutcome, setConfirmOutcome] = useState<ConfirmationOutcome>("confirmed_by_organiser");
  const [confirmNote, setConfirmNote] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      readRecord<LocalBill>(billRecordId(billId)),
      listLocalRequests(),
    ]).then(([record, allRequests]) => {
      if (cancelled) return;
      if (!record) throw new Error("This bill was not found in your local encrypted workspace.");
      validateBillManifest(record.value.manifest, billId);
      setBillRecord(record);
      setRequests(allRequests
        .filter((request) => request.value.billId === billId && request.value.role === "organiser")
        .map((request) => request.value));
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load bill.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [billId]);

  const reconcileCurrentBill = async () => {
    if (!billRecord) throw new Error("Open the bill before synchronising it.");
    const synced = await syncBillRequests(relay, billRecord, requests);
    const record = { id: billRecord.id, revision: synced.localBillRevision, value: synced.bill };
    setBillRecord(record);
    setRequests(synced.requests);
    if (synced.missingRequestIds.length) {
      throw new Error("Some published requests are unavailable on the relay. Resolve this before making changes.");
    }
    return record;
  };

  const handleSync = async () => {
    if (!billRecord || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await reconcileCurrentBill();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handlePublish = async (participantId: string) => {
    if (!billRecord || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const current = await reconcileCurrentBill();
      const published = await publishRequest(relay, current, participantId, appUrl);
      setBillRecord({ id: billRecord.id, revision: published.localBillRevision, value: published.bill });
      setRequests((prev) => [...prev.filter((r) => r.requestId !== published.state.requestId), published.state]);

      setActiveInviteUrl(published.inviteUrl);
      setCopiedInvite(false);
      setInviteModalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish request.");
    } finally {
      setSyncing(false);
    }
  };

  const handleConfirmSubmit = async () => {
    if (!billRecord || !selectedRequest || confirmBusy || syncing) return;
    setConfirmBusy(true);
    setError(null);
    try {
      const current = await reconcileCurrentBill();
      const targetReqRecord = await readLocalRequest(selectedRequest.requestId);
      if (!targetReqRecord) throw new Error("This request is no longer in the local workspace. Sync the bill again.");
      const previousConfirmation = evaluateDetailedTracking(targetReqRecord.value).latestConfirmation;

      const result = await confirmPayment(relay, current, targetReqRecord, {
        receivedTotalZatoshis: confirmZatoshis,
        outcome: confirmOutcome,
        note: confirmNote || null,
        correctionReason: confirmOutcome === "correction" ? confirmNote.trim() || null : null,
        previousConfirmationId: confirmOutcome === "correction" ? previousConfirmation?.id ?? null : null,
      });

      setRequests((prev) =>
        prev.map((r) => (r.requestId === result.state.requestId ? result.state : r)),
      );
      setConfirmModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Confirmation failed.");
    } finally {
      setConfirmBusy(false);
    }
  };

  const handleArchiveToggle = async () => {
    if (!billRecord || syncing) return;
    setSyncing(true);
    setError(null);
    const isArchived = billRecord.value.manifest.status === "archived";
    try {
      const current = await reconcileCurrentBill();
      const synced = await archiveBill(relay, current, !isArchived);
      setBillRecord({ id: billRecord.id, revision: synced.localRevision, value: synced.bill });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle archive.");
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async () => {
    if (!billRecord || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const current = await reconcileCurrentBill();
      await deleteBill(relay, current);
      router.push("/app/history");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return <StatePanel title="Opening bill..." description="Decrypting manifest from IndexedDB." busy />;
  }

  if (error && !billRecord) {
    return (
      <StatePanel
        title="Bill not available"
        description={error}
        tone="danger"
        action={
          <Link href="/app" className={actionClass("secondary")}>
            <ArrowLeft /> Back to home
          </Link>
        }
      />
    );
  }

  const bill = billRecord!.value;
  const manifest = bill.manifest;
  const isArchived = manifest.status === "archived";
  const wholeBillZec = formatZec(BigInt(manifest.conversion.wholeBillZatoshis));

  // Compute tracking metrics
  const summary = evaluateBillTracking(bill, requests);

  return (
    <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Link href="/app" className={`${actionClass("ghost")} px-3 text-xs`}>
          <ArrowLeft /> Back
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || confirmBusy || deleteBusy}
            className={`${actionClass("secondary")} text-xs px-3.5`}
            title="Fetch latest updates from the relay"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Syncing..." : "Sync"}
          </button>
          <button
            type="button"
            onClick={handleArchiveToggle}
            disabled={syncing || confirmBusy || deleteBusy}
            className={`${actionClass("ghost")} text-xs px-3`}
            title={isArchived ? "Unarchive bill" : "Archive bill"}
          >
            <Archive size={14} />
            {isArchived ? "Unarchive" : "Archive"}
          </button>
          <button
            type="button"
            onClick={() => setDeleteModalOpen(true)}
            disabled={syncing || confirmBusy || deleteBusy}
            className={`${actionClass("danger")} text-xs px-3`}
            title="Delete bill"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <PageHeader
        eyebrow={`Bill Created ${new Date(manifest.createdAt).toLocaleDateString()}`}
        title={
          <div className="flex items-center gap-3">
            <span>{manifest.title}</span>
            {isArchived ? (
              <Pill tone="neutral">
                <Archive size={13} /> Archived
              </Pill>
            ) : summary.isFullySettled ? (
              <Pill tone="success">
                <Check size={13} /> Settled
              </Pill>
            ) : (
              <Pill tone="info">Active</Pill>
            )}
          </div>
        }
        description={`Total ${manifest.receipt.currency} ${formatDecimal(manifest.receipt.totalMinor, manifest.receipt.scale)} converted to ${wholeBillZec} ZEC on ${manifest.receiving.network}.`}
      />

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-6">
          {/* Participants & Requests Section */}
          <Panel className="space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium tracking-tight">Participant Reimbursements</h3>
              <Pill tone="neutral">
                <Users size={13} /> {manifest.participants.length} people
              </Pill>
            </div>

            <p className="text-xs text-muted-foreground">
              Receipt status reflects the organiser&apos;s acknowledgement, not independent on-chain verification.
            </p>

            <div className="space-y-3">
              {manifest.participants.map((part) => {
                const reqEntry = manifest.requests.find((r) => r.participantId === part.id);
                const reqState = reqEntry
                  ? requests.find((s) => s.requestId === reqEntry.requestId)
                  : undefined;
                const tracking = reqState ? evaluateDetailedTracking(reqState) : null;

                const isOrganiser = part.isOrganiser;
                const alloc = manifest.allocations.find((a) => a.participantId === part.id);
                const shareZec = formatZec(BigInt(alloc?.zatoshis || "0"));

                return (
                  <div
                    key={part.id}
                    className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-border sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground truncate">
                          {part.label}
                        </span>
                        {isOrganiser ? (
                          <Pill tone="info" className="py-0 px-2 text-[10px]">
                            Host
                          </Pill>
                        ) : reqEntry?.lifecycle === "revoked" ? (
                          <Pill tone="danger" className="py-0 px-2 text-[10px]">
                            Revoked
                          </Pill>
                        ) : tracking?.isFullyPaid ? (
                          <Pill tone="success" className="py-0 px-2 text-[10px]">
                            <Check size={11} /> Receipt Confirmed
                          </Pill>
                        ) : tracking?.hasUnresolvedReport ? (
                          <Pill tone="warning" className="py-0 px-2 text-[10px]">
                            Payment Reported
                          </Pill>
                        ) : reqEntry?.publishedAt ? (
                          <Pill tone="neutral" className="py-0 px-2 text-[10px]">
                            Awaiting Payment
                          </Pill>
                        ) : (
                          <Pill tone="neutral" className="py-0 px-2 text-[10px]">
                            Not Shared
                          </Pill>
                        )}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">
                        {shareZec} ZEC
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isOrganiser ? (
                        <span className="text-xs text-muted-foreground italic">Your share</span>
                      ) : !reqEntry || !reqEntry.publishedAt ? (
                        <Action
                          variant="primary"
                          onClick={() => handlePublish(part.id)}
                          disabled={syncing || confirmBusy || deleteBusy || isArchived || !alloc || BigInt(alloc.zatoshis) === 0n}
                          className="text-xs h-9 px-4"
                        >
                          <Share2 size={13} /> Share Link
                        </Action>
                      ) : (
                        <>
                          {tracking && reqState && reqEntry.lifecycle !== "revoked" ? (
                            <Action
                              variant="primary"
                              onClick={() => {
                                setSelectedRequest(reqState!);
                                setConfirmZatoshis("");
                                setConfirmOutcome("confirmed_by_organiser");
                                setConfirmNote("");
                                setError(null);
                                setConfirmModalOpen(true);
                              }}
                              disabled={syncing || confirmBusy || deleteBusy}
                              className="text-xs h-9 px-3"
                            >
                              <FileCheck size={13} /> Confirm
                            </Action>
                          ) : null}

                          <Action
                            variant="secondary"
                            onClick={() => {
                              try {
                                if (!reqState) throw new Error("Sync this request before sharing its invitation.");
                                setActiveInviteUrl(inviteUrl(appUrl, reqEntry.requestId, {
                                  version: 1,
                                  requestId: reqEntry.requestId,
                                  readCapability: reqEntry.readCapability,
                                  reportCapability: reqEntry.reportCapability,
                                  publicKey: reqState.pinnedPublicKey,
                                  contentKey: reqEntry.contentKey,
                                }));
                                setCopiedInvite(false);
                                setError(null);
                                setInviteModalOpen(true);
                              } catch (err) {
                                setError(err instanceof Error ? err.message : "Could not open the invitation.");
                              }
                            }}
                            className="text-xs h-9 px-3"
                            title="Show invite link"
                          >
                            <ExternalLink size={13} />
                          </Action>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        {/* Sidebar Info */}
        <aside className="space-y-6">
          <Panel className="space-y-4">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Receiving Address
            </h4>
            <div className="rounded-xl border border-border/60 bg-background/60 p-3">
              <p className="font-mono text-[11px] break-all text-foreground">
                {manifest.receiving.address}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Shielded testnet address for reimbursements. Verify receipt in your external wallet before confirming.
            </p>
          </Panel>

          <Panel className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Relay Retention
            </h4>
            <div className="flex items-center gap-2 text-xs">
              <Clock size={14} className="text-muted-foreground" />
              <span>Retained until {bill.retainedUntil ? new Date(bill.retainedUntil).toLocaleDateString() : "Pending"}</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Envelopes are held on the relay for 30 days. Backup your workspace before retention expires.
            </p>
          </Panel>
        </aside>
      </div>

      {/* Share Invite Modal */}
      <AppDialog open={inviteModalOpen} onClose={() => setInviteModalOpen(false)}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Pill tone="success">
              <Lock size={12} /> FRAGMENT ENCRYPTION KEY
            </Pill>
            <h3 className="text-xl font-semibold tracking-tight">Private Invitation Link</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Share this link privately with the participant. The decryption content key is stored only after the hash
              (#) symbol and is never seen by the server or relay.
            </p>
          </div>

          <div className="rounded-xl border border-border/80 bg-background p-3 flex items-center justify-between gap-2">
            <span className="font-mono text-xs truncate text-foreground select-all">
              {activeInviteUrl}
            </span>
            <Action
              variant="secondary"
              onClick={async () => {
                if (activeInviteUrl) {
                  try {
                    await navigator.clipboard.writeText(activeInviteUrl);
                    setCopiedInvite(true);
                    setTimeout(() => setCopiedInvite(false), 2000);
                  } catch {
                    setCopiedInvite(false);
                    setError("The invitation could not be copied. Select the link and copy it manually.");
                  }
                }
              }}
              className="shrink-0 h-8 px-3 text-xs"
            >
              {copiedInvite ? <Check size={13} className="text-teal-500" /> : <Copy size={13} />}
              {copiedInvite ? "Copied" : "Copy"}
            </Action>
          </div>

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

          <Action onClick={() => setInviteModalOpen(false)} className="w-full">
            Done
          </Action>
        </div>
      </AppDialog>

      {/* Confirm Payment Modal */}
      <AppDialog open={confirmModalOpen} onClose={() => (!confirmBusy ? setConfirmModalOpen(false) : undefined)}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Pill tone="info">
              <ShieldCheck size={12} /> MANUAL CONFIRMATION
            </Pill>
            <h3 className="text-xl font-semibold tracking-tight">Confirm Received Payment</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Check your external testnet wallet and enter the cumulative amount actually received.
              A participant report alone is not proof of receipt.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="confirm-amount" className="text-xs font-medium">
                Cumulative Received (Zatoshis)
              </label>
              <input
                id="confirm-amount"
                type="text"
                inputMode="numeric"
                value={confirmZatoshis}
                onChange={(e) => {
                  if (/^(?:0|[1-9]\d{0,15})?$/.test(e.target.value)) setConfirmZatoshis(e.target.value);
                }}
                className={`${fieldClass} font-mono`}
              />
              <p className="text-[11px] text-muted-foreground font-mono">
                {confirmZatoshis ? formatZec(BigInt(confirmZatoshis || "0")) : "0.00"} ZEC
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-outcome" className="text-xs font-medium">
                Outcome
              </label>
              <select
                id="confirm-outcome"
                value={confirmOutcome}
                onChange={(e) => {
                  const outcome = e.target.value;
                  if (outcome === "confirmed_by_organiser" || outcome === "partially_confirmed" || outcome === "overpaid" || outcome === "correction") {
                    setConfirmOutcome(outcome);
                  }
                }}
                className={fieldClass}
              >
                <option value="confirmed_by_organiser">Full Payment</option>
                <option value="partially_confirmed">Partial Payment</option>
                <option value="correction" disabled={!selectedRequest?.confirmations.length}>Correction</option>
                <option value="overpaid">Overpaid</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="confirm-note" className="text-xs font-medium">
                {confirmOutcome === "correction" ? "Reason for correction (required)" : "Note (optional)"}
              </label>
              <input
                id="confirm-note"
                type="text"
                value={confirmNote}
                onChange={(e) => setConfirmNote(e.target.value)}
                placeholder="Describe your wallet receipt check"
                className={fieldClass}
              />
            </div>
          </div>

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2">
            <Action onClick={handleConfirmSubmit} disabled={confirmBusy || syncing || !confirmZatoshis || (confirmOutcome === "correction" && !confirmNote.trim())} className="w-full">
              {confirmBusy ? "Signing & committing..." : "Sign & Commit Confirmation"}
            </Action>
            <Action variant="ghost" onClick={() => setConfirmModalOpen(false)} disabled={confirmBusy} className="w-full text-xs">
              Cancel
            </Action>
          </div>
        </div>
      </AppDialog>

      {/* Delete Dialog */}
      <AppDialog open={deleteModalOpen} onClose={() => (!deleteBusy ? setDeleteModalOpen(false) : undefined)}>
        <div className="space-y-5">
          <div className="space-y-2">
            <h3 className="text-xl font-semibold tracking-tight text-destructive">Delete Bill</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              This will authenticate with your edit capability and delete this bill and its requests from the relay,
              as well as your local storage.
            </p>
          </div>

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2">
            <Action variant="danger" onClick={handleDelete} disabled={deleteBusy} className="w-full">
              {deleteBusy ? "Deleting..." : "Permanently Delete"}
            </Action>
            <Action variant="ghost" onClick={() => setDeleteModalOpen(false)} disabled={deleteBusy} className="w-full text-xs">
              Cancel
            </Action>
          </div>
        </div>
      </AppDialog>
    </div>
  );
}

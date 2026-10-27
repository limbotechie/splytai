"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import QRCode from "qrcode";
import {
  Check,
  Clock,
  Copy,
  Lock,
  Receipt,
  RefreshCw,
  Send,
  Wallet,
  AlertCircle,
  FileCheck,
} from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import {
  captureAndStoreInvite,
  readParticipantInvite,
  syncParticipantRequest,
  submitPaymentReport,
} from "@/lib/workflow/participant";
import { evaluateDetailedTracking } from "@/lib/workflow/tracking";
import type { RequestState } from "@/lib/requests/types";
import { formatDecimal, formatZec } from "@/lib/bills/money";
import { clearInviteFragmentFromLocation } from "@/lib/requests/invite";
import { validateAddress } from "@/lib/zcash/address";
import { paymentUri } from "@/lib/zcash/uri";
import { Action, PageHeader, Panel, Pill, StatePanel, actionClass, fieldClass } from "@/components/app/common/Primitives";
import { AppDialog } from "@/components/app/common/AppDialog";

interface Props {
  params: Promise<{ requestId: string }>;
}

export default function ParticipantPayPage({ params }: Props) {
  const { requestId } = use(params);
  return <ParticipantPayContent key={requestId} requestId={requestId} />;
}

function ParticipantPayContent({ requestId }: { requestId: string }) {
  const { relay } = useWorkspace();
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payment, setPayment] = useState<{ request: RequestState; uri: string; qrDataUrl: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const opening = useRef<{ relay: typeof relay; request: Promise<RequestState> } | null>(null);

  // Copy status
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [copiedMemo, setCopiedMemo] = useState(false);

  // Report modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportAmountZatoshis, setReportAmountZatoshis] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [reportTxRef, setReportTxRef] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportSuccess, setReportSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const open = async () => {
      const rawUrl = window.location.hash ? window.location.href : null;
      if (rawUrl) clearInviteFragmentFromLocation();
      const invite = rawUrl
        ? await captureAndStoreInvite(rawUrl)
        : await readParticipantInvite(requestId);
      if (!invite || invite.requestId !== requestId) {
        throw new Error("This private invitation link is missing or incomplete. Ask the organiser to re-share the full link.");
      }
      const state = await syncParticipantRequest(relay, requestId);
      if (state.payload.payload.network !== "testnet") throw new Error("Only Zcash testnet payment requests are supported.");
      return state;
    };

    // Reuse the in-flight capture during Strict Mode's effect replay after the fragment is stripped.
    if (!opening.current || opening.current.relay !== relay) {
      opening.current = { relay, request: open() };
    }
    opening.current.request.then((state) => {
      if (cancelled) return;
      setRequestState(state);
      setNow(Date.now());
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load request.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [relay, requestId, attempt]);

  const tracking = requestState ? evaluateDetailedTracking(requestState, now) : null;
  const canPay = Boolean(tracking && tracking.lifecycle === "active" && !tracking.isFullyPaid && !tracking.hasUnresolvedReport && !refreshing && !syncFailed);
  const remainingZatoshis = tracking?.remainingZatoshis;
  const expiresAt = requestState?.payload.payload.expiresAt;

  useEffect(() => {
    if (!expiresAt || now >= Date.parse(expiresAt)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(2_147_483_647, Math.max(0, Date.parse(expiresAt) - Date.now())));
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  useEffect(() => {
    if (!requestState || !canPay || !remainingZatoshis) return;
    let cancelled = false;
    const payload = requestState.payload.payload;
    validateAddress(payload.address, "testnet").then(async (receiving) => {
      const uri = paymentUri(receiving, remainingZatoshis, payload.reference);
      const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 280 });
      return { request: requestState, uri, qrDataUrl };
    }).then((result) => {
      if (!cancelled) setPayment(result);
    }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "The wallet handoff could not be prepared. Refresh to try again.");
    });
    return () => { cancelled = true; };
  }, [requestState, canPay, remainingZatoshis]);

  const handleRefresh = async () => {
    if (!requestState || refreshing || reportBusy) return;
    setRefreshing(true);
    setError(null);
    try {
      const updated = await syncParticipantRequest(relay, requestId);
      setRequestState(updated);
      setNow(Date.now());
      setSyncFailed(false);
    } catch (err) {
      setSyncFailed(true);
      setError(err instanceof Error ? err.message : "The relay could not be refreshed. Payment status may be out of date.");
    } finally {
      setRefreshing(false);
    }
  };

  const handleReportSubmit = async () => {
    if (!requestState || reportBusy) return;
    setReportBusy(true);
    setError(null);
    try {
      const updated = await submitPaymentReport(relay, requestId, {
        claimedZatoshis: reportAmountZatoshis,
        reference: reportTxRef || null,
        note: reportNote || null,
      });
      setRequestState(updated);
      setNow(Date.now());
      setReportModalOpen(false);
      setReportSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit payment report.");
    } finally {
      setReportBusy(false);
    }
  };

  if (loading) {
    return <StatePanel title="Opening private payment request..." description="Decrypting request envelope with your fragment key." busy />;
  }

  if (error && !requestState) {
    return (
      <div className="flex flex-1 flex-col py-8 sm:py-12">
        <StatePanel
          title="Invitation not available"
          description={error}
          tone="danger"
          action={
            <div className="flex flex-wrap gap-2">
              <Action variant="secondary" onClick={() => {
                opening.current = null;
                setLoading(true);
                setError(null);
                setAttempt((value) => value + 1);
              }}><RefreshCw size={14} /> Retry</Action>
              <Link href="/" className={actionClass("ghost")}>Go to Splyt Home</Link>
            </div>
          }
        />
      </div>
    );
  }

  if (!requestState || !tracking) return null;
  const payload = requestState.payload.payload;
  const handoff = payment?.request === requestState && canPay ? payment : null;
  const shareZec = formatZec(BigInt(payload.amountZatoshis));

  return (
    <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Pill tone="success">
            <Lock size={12} /> END-TO-END ENCRYPTED
          </Pill>
          <Pill tone="info" className="uppercase">
            {payload.network}
          </Pill>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || reportBusy}
          className={`${actionClass("ghost")} text-xs px-3`}
          title="Refresh payment status"
        >
          <RefreshCw size={13} className={refreshing ? "animate-spin" : undefined} /> {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? (
        <Panel role="alert" className="flex items-center gap-2 border-destructive/30 text-xs text-destructive">
          <AlertCircle size={15} className="shrink-0" /> {error}
        </Panel>
      ) : null}

      <PageHeader
        eyebrow={`Reimbursement Request for ${payload.participantLabel}`}
        title={
          <div className="flex items-center gap-3">
            <span>{payload.receipt.title}</span>
            {tracking.isFullyPaid ? (
              <Pill tone="success">
                <Check size={13} /> Organiser Confirmed
              </Pill>
            ) : tracking.hasUnresolvedReport ? (
              <Pill tone="warning">Payment Reported</Pill>
            ) : tracking.lifecycle !== "active" ? (
              <Pill tone="neutral" className="capitalize">{tracking.lifecycle}</Pill>
            ) : (
              <Pill tone="neutral">Payment Due</Pill>
            )}
          </div>
        }
        description={`Your original share is ${payload.receipt.currency} ${formatDecimal(payload.receipt.shareMinor, payload.receipt.scale)} (${shareZec} ZEC). Wallet handoff is testnet-only and does not broadcast or verify a transfer.`}
      />

      {/* Confirmation Celebration Banner */}
      {tracking.isFullyPaid ? (
        <Panel className="border-teal-500/40 bg-teal-500/10 p-6 space-y-2">
          <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300 font-semibold text-lg">
            <Check size={20} /> Payment Confirmed by Organiser
          </div>
          <p className="text-xs text-muted-foreground">
            The organiser confirmed receipt of {formatZec(BigInt(tracking.receivedTotalZatoshis))} ZEC in their wallet.
            This is their signed acknowledgement, not independent on-chain verification by Splyt.
          </p>
        </Panel>
      ) : tracking.hasUnresolvedReport ? (
        <Panel className="border-amber-500/40 bg-amber-500/10 p-5 space-y-1">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 font-medium text-sm">
            <Clock size={16} /> Payment Reported
          </div>
          <p className="text-xs text-muted-foreground">
            You reported paying {formatZec(BigInt(tracking.latestReport?.payload.claimedZatoshis || payload.amountZatoshis))} ZEC.
            This report is unverified. Awaiting organiser confirmation of actual receipt.
          </p>
        </Panel>
      ) : null}

      {reportSuccess ? <p role="status" className="text-xs text-muted-foreground">Your payment report was saved. Only the organiser can acknowledge receipt after checking their wallet.</p> : null}

      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1.2fr)] lg:gap-8">
        {/* Left: Payment instructions & QR */}
        <div className="space-y-6">
          <Panel className="flex flex-col items-center gap-5 text-center p-6 sm:p-8">
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {canPay ? "Remaining Amount to Send" : "Original Request Amount"}
              </span>
              <p className="font-mono text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
                {canPay ? formatZec(tracking.remainingZatoshis) : shareZec} ZEC
              </p>
            </div>

            {handoff ? (
              <div className="rounded-2xl border border-border/80 bg-white p-3 shadow-md">
                <Image
                  src={handoff.qrDataUrl}
                  alt="Zcash ZIP 321 Payment QR Code"
                  width={280}
                  height={280}
                  unoptimized
                  className="size-56 sm:size-64"
                />
              </div>
            ) : null}

            <div className="w-full space-y-2">
              {handoff ? (
                <a
                  href={handoff.uri}
                  onClick={(event) => {
                    if (Date.now() >= Date.parse(payload.expiresAt)) {
                      event.preventDefault();
                      setNow(Date.now());
                      setError("This request has expired. Ask the organiser for a new request before sending.");
                    }
                  }}
                  className={`${actionClass("primary")} w-full text-sm`}
                >
                  <Wallet size={16} /> Open in Zcash Wallet
                </a>
              ) : (
                <p role="status" className="text-xs text-muted-foreground">
                  {tracking.isFullyPaid ? "The organiser has acknowledged the full amount. No further payment is requested."
                    : tracking.lifecycle !== "active" ? "This request is no longer active. Ask the organiser before sending funds."
                    : tracking.hasUnresolvedReport ? "Wait for the organiser to review your existing report before sending again."
                    : syncFailed ? "Refresh the relay successfully before opening a wallet handoff."
                    : error ? "Wallet handoff is unavailable. Resolve the error above and refresh."
                    : "Preparing the validated testnet wallet request..."}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Use an external wallet that supports testnet shielded ZIP 321 requests. Check the network, address, amount, and memo before sending.
              </p>
            </div>
          </Panel>

          {/* Shielded Address & Memo Details */}
          <Panel className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">Receiving Shielded Address</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(payload.address);
                      setCopiedAddress(true);
                      setTimeout(() => setCopiedAddress(false), 2000);
                    } catch {
                      setCopiedAddress(false);
                      setError("The receiving address could not be copied. Select and copy it manually.");
                    }
                  }}
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {copiedAddress ? <Check size={12} /> : <Copy size={12} />}
                  {copiedAddress ? "Copied" : "Copy address"}
                </button>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-3 font-mono text-xs break-all select-all">
                {payload.address}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">Required Reference Memo</span>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(payload.reference);
                      setCopiedMemo(true);
                      setTimeout(() => setCopiedMemo(false), 2000);
                    } catch {
                      setCopiedMemo(false);
                      setError("The reference memo could not be copied. Select and copy it manually.");
                    }
                  }}
                  className="text-primary hover:underline flex items-center gap-1"
                >
                  {copiedMemo ? <Check size={12} /> : <Copy size={12} />}
                  {copiedMemo ? "Copied" : "Copy memo"}
                </button>
              </div>
              <div className="rounded-xl border border-border/70 bg-background/60 p-3 font-mono text-xs select-all text-primary font-semibold">
                {payload.reference}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Include this reference in your wallet transaction memo so the organiser can match your payment.
              </p>
            </div>
          </Panel>
        </div>

        {/* Right: Receipt details & report button */}
        <div className="space-y-6">
          {/* Disclosed Receipt Breakdown */}
          <Panel className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium tracking-tight">Receipt Details</h3>
              <Pill tone="neutral">
                <Receipt size={13} /> {payload.disclosure} disclosure
              </Pill>
            </div>

            {payload.receipt.items && payload.receipt.items.length > 0 ? (
              <div className="divide-y divide-border/60 text-xs">
                {payload.receipt.items.map((it, idx) => (
                  <div key={idx} className="flex justify-between py-2">
                    <span className="text-foreground">{it.label}</span>
                    <span className="font-mono text-muted-foreground">
                      {formatDecimal(it.amountMinor, payload.receipt.scale)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="border-t border-border/80 pt-3 space-y-1.5 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span className="font-mono">{formatDecimal(payload.receipt.subtotalMinor, payload.receipt.scale)}</span>
              </div>
              {Number(payload.receipt.taxMinor) > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tax</span>
                  <span className="font-mono">{formatDecimal(payload.receipt.taxMinor, payload.receipt.scale)}</span>
                </div>
              ) : null}
              {Number(payload.receipt.tipMinor) > 0 ? (
                <div className="flex justify-between text-muted-foreground">
                  <span>Tip</span>
                  <span className="font-mono">{formatDecimal(payload.receipt.tipMinor, payload.receipt.scale)}</span>
                </div>
              ) : null}
              <div className="flex justify-between font-semibold text-foreground pt-1 border-t border-border/40">
                <span>Your Share ({payload.receipt.currency})</span>
                <span className="font-mono">{formatDecimal(payload.receipt.shareMinor, payload.receipt.scale)}</span>
              </div>
            </div>
          </Panel>

          {/* Report Payment Action */}
          {!tracking.isFullyPaid && tracking.lifecycle !== "revoked" && tracking.lifecycle !== "cancelled" ? (
            <Panel className="space-y-3">
              <h4 className="text-sm font-semibold tracking-tight">Already sent your reimbursement?</h4>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Only report a transfer you actually sent. A report is not proof that the organiser received it.
              </p>
              <Action
                variant="secondary"
                onClick={() => {
                  setReportAmountZatoshis("");
                  setReportNote("");
                  setReportTxRef("");
                  setReportSuccess(false);
                  setError(null);
                  setReportModalOpen(true);
                }}
                className="w-full text-xs"
              >
                <Send size={14} /> Report Payment Sent
              </Action>
            </Panel>
          ) : null}
        </div>
      </div>

      {/* Report Payment Modal */}
      <AppDialog open={reportModalOpen} onClose={() => (!reportBusy ? setReportModalOpen(false) : undefined)}>
        <div className="space-y-5">
          <div className="space-y-2">
            <Pill tone="info">
              <FileCheck size={12} /> PAYMENT REPORT
            </Pill>
            <h3 className="text-xl font-semibold tracking-tight">Report Payment</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Notify the organiser that you sent your reimbursement. Encrypted and sent to the relay using your report capability.
            </p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="report-amount" className="text-xs font-medium">
                Amount Sent (Zatoshis)
              </label>
              <input
                id="report-amount"
                type="text"
                inputMode="numeric"
                value={reportAmountZatoshis}
                onChange={(e) => {
                  if (/^(?:0|[1-9]\d{0,15})?$/.test(e.target.value)) setReportAmountZatoshis(e.target.value);
                }}
                className={`${fieldClass} font-mono`}
              />
              <p className="text-[11px] text-muted-foreground font-mono">
                {reportAmountZatoshis ? formatZec(BigInt(reportAmountZatoshis || "0")) : "0.00"} ZEC
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="report-tx" className="text-xs font-medium">
                Transaction ID or Reference (optional)
              </label>
              <input
                id="report-tx"
                type="text"
                value={reportTxRef}
                onChange={(e) => setReportTxRef(e.target.value)}
                placeholder="e.g. splyt-... or txid"
                className={fieldClass}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="report-note" className="text-xs font-medium">
                Note to Organiser (optional)
              </label>
              <input
                id="report-note"
                type="text"
                value={reportNote}
                onChange={(e) => setReportNote(e.target.value)}
                placeholder="e.g. Sent from Zashi mobile wallet"
                className={fieldClass}
              />
            </div>
          </div>

          {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}

          <div className="flex flex-col gap-2">
            <Action onClick={handleReportSubmit} disabled={reportBusy || !reportAmountZatoshis} className="w-full">
              {reportBusy ? "Submitting report..." : "Submit Payment Report"}
            </Action>
            <Action variant="ghost" onClick={() => setReportModalOpen(false)} disabled={reportBusy} className="w-full text-xs">
              Cancel
            </Action>
          </div>
        </div>
      </AppDialog>
    </div>
  );
}

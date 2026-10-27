"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { FlowHeader } from "@/components/app/shell/FlowHeader";
import { SplitEditor } from "@/components/app/split/SplitEditor";
import { CreateBillSheet } from "@/components/app/split/CreateBillSheet";
import { ForwardCTA } from "@/components/app/common/ForwardCTA";
import { useWorkspace } from "@/context/WorkspaceContext";
import { Action, PageHeader, Panel, Pill, fieldClass } from "@/components/app/common/Primitives";
import { DraftState, DraftSummary } from "@/components/app/common/DraftSummary";
import { useDraft } from "@/components/app/common/useDraft";
import type { ApprovedConversion } from "@/lib/bills/types";
import { formatZec } from "@/lib/bills/money";
import { allocateBill } from "@/lib/bills/split";
import { validateQuote, type RateQuote } from "@/lib/rates";
import { draftBillDetails, draftConversionZatoshis } from "@/components/app/split/draft-input";

interface Props {
  params: Promise<{ draftId: string }>;
}

export default function SplitPage({ params }: Props) {
  const { draftId } = use(params);
  return <SplitContent key={draftId} draftId={draftId} />;
}

function SplitContent({ draftId }: { draftId: string }) {
  const router = useRouter();
  const { relay, network } = useWorkspace();
  const [createOpen, setCreateOpen] = useState(false);

  // Zcash receiving address & conversion state
  const [receivingAddress, setReceivingAddress] = useState("");
  const [conversionSource, setConversionSource] = useState<ApprovedConversion["source"]>("coingecko");
  const [manualZec, setManualZec] = useState("");
  const [rateAttempt, setRateAttempt] = useState(0);
  const [rateResult, setRateResult] = useState<{
    currency: string; attempt: number; relay: typeof relay; quote: RateQuote | null; error: string | null;
  } | null>(null);
  const [approval, setApproval] = useState<{
    currency: string; receiptTotal: string; manualZec: string; conversion: ApprovedConversion;
  } | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  const { draft, setDraft, loading, loadError, reload, saving, saveError, saved, save } = useDraft(
    draftId,
    !createOpen,
  );

  const currency = draft?.receipt.currency;

  useEffect(() => {
    if (!currency) return;
    let cancelled = false;
    relay.rates(currency).then((quote) => {
      validateQuote(quote, currency);
      if (!cancelled) setRateResult({ currency, attempt: rateAttempt, relay, quote, error: null });
    }).catch((err: unknown) => {
      if (!cancelled) setRateResult({
        currency, attempt: rateAttempt, relay, quote: null,
        error: err instanceof Error ? err.message : "The live rate is unavailable. Refresh or choose a manual ZEC total.",
      });
    });
    return () => { cancelled = true; };
  }, [currency, relay, rateAttempt]);

  const rateLoading = Boolean(currency && (rateResult?.currency !== currency || rateResult?.attempt !== rateAttempt || rateResult?.relay !== relay));
  const liveQuote = !rateLoading ? rateResult?.quote ?? null : null;

  useEffect(() => {
    if (!liveQuote) return;
    const timer = setTimeout(() => {
      setRateResult((previous) => previous?.quote === liveQuote ? {
        ...previous, quote: null, error: "This market quote is stale. Refresh it or explicitly enter a manual ZEC total.",
      } : previous);
    }, Math.max(0, Date.parse(liveQuote.updatedAt) + 5 * 60_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [liveQuote]);

  if (!draft)
    return (
      <>
        <FlowHeader step="split" />
        <DraftState loading={loading} error={loadError} onRetry={reload} />
      </>
    );

  let suggestedZatoshis: string | null = null;
  let conversionError: string | null = null;
  try {
    suggestedZatoshis = draftConversionZatoshis(draft, conversionSource, conversionSource === "coingecko" ? liveQuote : null, manualZec);
  } catch (err) {
    conversionError = err instanceof Error ? err.message : "Review the ZEC conversion.";
  }
  const conversionQuote = approval && !conversionError && approval.currency === draft.receipt.currency &&
    approval.receiptTotal === draft.receipt.total && approval.conversion.source === conversionSource &&
    (conversionSource === "manual" ? approval.manualZec === manualZec : approval.conversion.quote === liveQuote)
    ? approval.conversion : null;
  const expiryDays = draft.expiresInMinutes / 1440;
  const validExpiry = Number.isInteger(expiryDays) && expiryDays >= 1 && expiryDays <= 90;
  let canCreate = Boolean(receivingAddress.trim() && conversionQuote && validExpiry);
  if (canCreate && conversionQuote) {
    try {
      const details = draftBillDetails(draft);
      allocateBill(details.receipt, details.participants, draft.mode, conversionQuote.wholeBillZatoshis);
    } catch {
      canCreate = false;
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <FlowHeader
        step="split"
        busy={saving}
        onBack={async () => {
          if (await save()) router.push(`/app/members/${draftId}`);
        }}
      />
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
        <PageHeader
          eyebrow="Set the shares"
          title={
            <>
              Choose how to <span className="font-serif italic">divide the bill.</span>
            </>
          }
          description="Select equal shares, assign specific items, or enter custom amounts. Approve the ZEC conversion rate and enter your shielded receiving address."
        />
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
          <div className="space-y-6">
            <Panel>
              <fieldset className="min-w-0">
                <legend className="sr-only">Split method and amounts</legend>
                <SplitEditor draft={draft} onChange={setDraft} />
              </fieldset>
            </Panel>

            {/* ZEC Conversion & Shielded Address Panel */}
            <Panel className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-base font-medium tracking-tight">Zcash Conversion & Shielded Payout</h3>
                  <p className="text-xs text-muted-foreground">
                    Reimbursements are settled privately via shielded Zcash (ZEC).
                  </p>
                </div>
                <Pill tone="info" className="uppercase">
                  {network}
                </Pill>
              </div>

              {/* Rate quotation */}
              <div className="rounded-2xl border border-border/70 bg-background/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="zec-conversion" className="text-xs font-medium text-muted-foreground">
                    {conversionSource === "coingecko" ? `Live Rate (${draft.receipt.currency} / ZEC)` : "Manual Whole-Bill ZEC Total"}
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setApproval(null);
                      setApprovalError(null);
                      setRateAttempt((value) => value + 1);
                    }}
                    disabled={rateLoading}
                    className="flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <RefreshCw size={12} className={rateLoading ? "animate-spin" : undefined} />
                    {rateLoading ? "Fetching..." : "Refresh rate"}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2" aria-label="Conversion source">
                  {(["coingecko", "manual"] as const).map((source) => (
                    <button key={source} type="button" aria-pressed={conversionSource === source}
                      onClick={() => { setConversionSource(source); setApproval(null); setApprovalError(null); }}
                      className={`rounded-full border px-3 py-2 text-xs ${conversionSource === source ? "border-primary/40 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground"}`}>
                      {source === "coingecko" ? "Live market quote" : "Enter ZEC manually"}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <input
                    id="zec-conversion"
                    type="text"
                    inputMode="decimal"
                    readOnly={conversionSource === "coingecko"}
                    value={conversionSource === "coingecko" ? liveQuote?.price ?? "" : manualZec}
                    onChange={(e) => { setManualZec(e.target.value); setApproval(null); setApprovalError(null); }}
                    placeholder={conversionSource === "coingecko" ? "Awaiting live rate" : "Enter your agreed ZEC total"}
                    className={`${fieldClass} font-mono`}
                  />
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground">Total in ZEC</p>
                    <p className="font-mono text-base font-semibold text-foreground">
                      {suggestedZatoshis ? `${formatZec(suggestedZatoshis)} ZEC` : "Not available"}
                    </p>
                  </div>
                </div>
                {conversionSource === "coingecko" && liveQuote ? (
                  <p className="text-[11px] text-muted-foreground">CoinGecko quote updated {new Date(liveQuote.updatedAt).toLocaleString()}.</p>
                ) : conversionSource === "manual" ? (
                  <p className="text-[11px] text-muted-foreground">This is your manually agreed total, not a live market quote.</p>
                ) : null}
                {!rateLoading && rateResult?.error ? (
                  <div className="flex flex-col gap-1">
                    <p role="alert" className="text-xs text-destructive">{rateResult.error}</p>
                    {conversionSource === "coingecko" ? (
                      <button
                        type="button"
                        onClick={() => { setConversionSource("manual"); setApproval(null); setApprovalError(null); }}
                        className="self-start text-xs text-primary underline hover:opacity-80"
                      >
                        Switch to manual ZEC entry
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {approvalError ? (
                  <p role="alert" className="text-xs text-destructive">{approvalError}</p>
                ) : (conversionError && !rateLoading && !rateResult?.error) ? (
                  <p role="alert" className="text-xs text-destructive">{conversionError}</p>
                ) : null}
                <Action variant="secondary" className="w-full text-xs" disabled={!suggestedZatoshis || Boolean(conversionQuote)}
                  onClick={() => {
                    try {
                      const quote = conversionSource === "coingecko" ? liveQuote : null;
                      const wholeBillZatoshis = draftConversionZatoshis(draft, conversionSource, quote, manualZec);
                      setApproval({ currency: draft.receipt.currency, receiptTotal: draft.receipt.total, manualZec,
                        conversion: { source: conversionSource, quote, wholeBillZatoshis, approvedAt: new Date().toISOString() } });
                      setApprovalError(null);
                    } catch (err) {
                      setApproval(null);
                      setApprovalError(err instanceof Error ? err.message : "The conversion could not be approved.");
                    }
                  }}>
                  {conversionQuote ? "Conversion approved" : conversionSource === "coingecko" ? "Approve live conversion" : "Approve manual ZEC total"}
                </Action>
              </div>

              {/* Shielded address input */}
              <div className="space-y-2">
                <label htmlFor="shielded-address" className="text-xs font-medium text-foreground">
                  Your Shielded Receiving Address
                </label>
                <input
                  id="shielded-address"
                  type="text"
                  value={receivingAddress}
                  onChange={(e) => setReceivingAddress(e.target.value)}
                  placeholder="e.g. ztestsapling1... or utest1... (Testnet shielded)"
                  className={`${fieldClass} font-mono text-xs`}
                />
                <p className="text-[11px] text-muted-foreground">
                  Participants will be instructed to pay their share to this shielded address with their unique reference memo.
                </p>
              </div>

              {/* Expiry selector */}
              <div className="space-y-2">
                <label htmlFor="expiry-days" className="text-xs font-medium text-foreground">
                  Payment Link Expiration
                </label>
                <select
                  id="expiry-days"
                  value={validExpiry ? expiryDays : ""}
                  onChange={(e) => setDraft({ ...draft, expiresInMinutes: Number(e.target.value) * 1440 })}
                  className={fieldClass}
                >
                  <option value="" disabled>Choose a supported expiry</option>
                  <option value={1}>1 day</option>
                  {validExpiry && ![1, 7, 14, 30].includes(expiryDays) ? <option value={expiryDays}>{expiryDays} days</option> : null}
                  <option value={7}>7 days</option>
                  <option value={14}>14 days (recommended)</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
            </Panel>
          </div>

          <aside className="min-w-0 space-y-6">
            <DraftSummary
              draft={draft}
              saved={saved}
              saving={saving}
              error={saveError}
              onRetry={() => {
                void save();
              }}
            >
              <ForwardCTA
                label="Review & create split"
                onClick={async () => {
                  if (await save()) setCreateOpen(true);
                }}
                disabled={!canCreate}
                busy={saving}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {!receivingAddress.trim()
                  ? "Enter your shielded receiving address to continue."
                  : !conversionQuote ? "Explicitly approve a live quote or your manual ZEC total."
                  : !validExpiry ? "Choose a payment link expiry between 1 and 90 days."
                  : "Review the receipt and assigned shares before creating the bill."}
              </p>
            </DraftSummary>
          </aside>
        </div>
      </div>

      {createOpen ? <CreateBillSheet
        draft={draft}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        receivingAddress={receivingAddress}
        conversionQuote={conversionQuote}
        expiryDays={expiryDays}
      /> : null}
    </div>
  );
}

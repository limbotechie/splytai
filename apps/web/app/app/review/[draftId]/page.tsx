"use client";

import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Camera } from "lucide-react";
import { FlowHeader } from "@/components/app/shell/FlowHeader";
import { ReviewEditor } from "@/components/app/review/ReviewEditor";
import { ForwardCTA } from "@/components/app/common/ForwardCTA";
import { ImagePicker } from "@/components/app/scan/ImagePicker";
import { processReceiptImage } from "@/lib/ocr";
import type { ParsedReceipt } from "@/lib/types";
import { Action, Panel, PageHeader } from "@/components/app/common/Primitives";
import { DraftState, DraftSummary } from "@/components/app/common/DraftSummary";
import { useDraft } from "@/components/app/common/useDraft";

interface Props {
  params: Promise<{ draftId: string }>;
}

export default function ReviewPage({ params }: Props) {
  const { draftId } = use(params);
  return <ReviewContent key={draftId} draftId={draftId} />;
}

function ReviewContent({ draftId }: { draftId: string }) {
  const router = useRouter();
  const { draft, setDraft, loading, loadError, reload, saving, saveError, saved, save } = useDraft(draftId);
  const [showRescan, setShowRescan] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const handleChange = (next: ParsedReceipt) => {
    if (!draft) return;
    setDraft({ ...draft, receipt: next });
  };

  const handleRescan = async (file: File) => {
    if (rescanning || saving) return;
    setRescanError(null);
    setRescanning(true);
    try {
      const candidate = await processReceiptImage(file);
      const receipt: ParsedReceipt = {
        title: candidate.title,
        items: candidate.items.map((it) => ({
          name: it.label,
          amount: (Number(it.amountMinor) / 100).toFixed(2),
        })),
        subtotal: (Number(candidate.subtotalMinor) / 100).toFixed(2),
        tax: (Number(candidate.taxMinor) / 100).toFixed(2),
        tip: (Number(candidate.tipMinor) / 100).toFixed(2),
        total: (Number(candidate.totalMinor) / 100).toFixed(2),
        currency: candidate.currency,
      };
      if (draft) setDraft({ ...draft, receipt });
      setShowRescan(false);
    } catch (err) {
      if (err instanceof Error) setRescanError(err.message);
      else setRescanError("Couldn't read this receipt. Try a clearer photo.");
    } finally {
      setRescanning(false);
    }
  };

  const handleContinue = async () => {
    if (!saving && !rescanning && (await save())) router.push(`/app/members/${draftId}`);
  };

  if (!draft)
    return (
      <>
        <FlowHeader step="review" />
        <DraftState loading={loading} error={loadError} onRetry={reload} />
      </>
    );

  return (
    <div className="flex flex-1 flex-col">
      <FlowHeader
        step="review"
        busy={saving || rescanning}
        onBack={async () => {
          if (await save()) router.back();
        }}
      />
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
        <PageHeader
          eyebrow="Review the receipt"
          title={
            <>
              Check the receipt <span className="font-serif italic">before continuing.</span>
            </>
          }
          description="Compare item names, amounts, tax, and tip. The final total will be divided into private ZEC shares for participants."
          action={
            <Action
              variant="secondary"
              onClick={() => {
                setShowRescan((prev) => !prev);
                setRescanError(null);
              }}
              disabled={saving || rescanning}
              aria-expanded={showRescan}
              aria-label="Re-scan receipt"
            >
              <Camera /> {showRescan ? "Hide re-scan" : "Re-scan receipt"}
            </Action>
          }
        />
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0 space-y-5">
            {showRescan ? (
              <div className="flex flex-col gap-3">
                <ImagePicker busy={rescanning} onFile={handleRescan} />
                {rescanError ? (
                  <p role="alert" className="rounded-[24px] bg-destructive/10 p-4 text-sm text-destructive">
                    {rescanError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Panel>
              <fieldset disabled={saving || rescanning} className="min-w-0">
                <legend className="sr-only">Edit receipt</legend>
                <ReviewEditor receipt={draft.receipt} onChange={handleChange} />
              </fieldset>
            </Panel>
          </div>
          <aside className="min-w-0">
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
                label="Choose who's splitting"
                onClick={handleContinue}
                busy={saving || rescanning}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Check that the final total includes tax and adjustments before adding participants.
              </p>
            </DraftSummary>
          </aside>
        </div>
      </div>
    </div>
  );
}

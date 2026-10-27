"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FileText, ShieldCheck, Check, LoaderCircle } from "lucide-react";
import { FlowHeader } from "@/components/app/shell/FlowHeader";
import { ImagePicker } from "@/components/app/scan/ImagePicker";
import { processReceiptImage, type OcrProgress } from "@/lib/ocr";
import { putDraft } from "@/lib/draft";
import { Action, Panel, PageHeader, Pill } from "@/components/app/common/Primitives";
import type { ParsedReceipt } from "@/lib/types";

export default function ScanPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);

  const saveReceipt = async (receipt: ParsedReceipt) => {
    if (typeof indexedDB === "undefined") {
      throw new Error("Browser storage is unavailable. Enable it to save your draft.");
    }
    const draftId = crypto.randomUUID();
    await putDraft({
      id: draftId,
      receipt,
      members: [],
      mode: "equal",
      amounts: [],
      expiresInMinutes: 60 * 24 * 7, // 7 days default
      createdAt: Date.now(),
    });
    router.push(`/app/review/${draftId}`);
  };

  const handleManualEntry = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const blankReceipt: ParsedReceipt = {
      items: [],
      subtotal: "0.00",
      tax: "0.00",
      total: "0.00",
      currency: "USD",
    };
    try {
      await saveReceipt(blankReceipt);
    } catch {
      setError("Couldn't save a new draft. Check browser storage and try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    if (pending.current) return;
    pending.current = true;
    setError(null);
    setBusy(true);
    setProgress({ status: "Preparing local OCR worker...", progress: 0.1 });

    try {
      const candidate = await processReceiptImage(file, {
        onProgress: (p) => setProgress(p),
      });

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

      await saveReceipt(receipt);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Couldn't process this receipt image. Try a clearer photo or enter manually.");
      }
    } finally {
      pending.current = false;
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <FlowHeader step="scan" label="Step 1 of 4" busy={busy} />
      <div className="flex flex-1 flex-col gap-8 py-8 sm:py-12">
        <PageHeader
          eyebrow="Add a receipt"
          title={
            <>
              Start your split <span className="font-serif italic">with the bill.</span>
            </>
          }
          description="Upload a photo for client-side OCR recognition or enter items manually. Photos are processed 100% locally in your browser and never uploaded."
        />
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-8">
          <section className="min-w-0 space-y-5" aria-label="Add your receipt">
            <ImagePicker busy={busy} onFile={handleFile} />

            {progress ? (
              <Panel className="flex items-center gap-3 border-primary/40 bg-primary/5 py-4 text-xs text-primary">
                <LoaderCircle className="size-4 animate-spin shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium capitalize">{progress.status}</p>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-primary/20">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${Math.round(progress.progress * 100)}%` }}
                    />
                  </div>
                </div>
                <span className="font-mono text-xs font-semibold">
                  {Math.round(progress.progress * 100)}%
                </span>
              </Panel>
            ) : null}

            {error ? (
              <Panel role="alert" className="border-destructive/30 text-sm text-destructive">
                <p>{error}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Try a clearer image, or enter the bill manually below.
                </p>
              </Panel>
            ) : null}

            <div className="flex items-center gap-3 text-xs text-muted-foreground/60">
              <hr className="flex-1 border-border/40" />
              or
              <hr className="flex-1 border-border/40" />
            </div>

            <Action
              variant="secondary"
              onClick={handleManualEntry}
              disabled={busy}
              aria-label="Enter receipt manually"
              className="w-full"
            >
              <FileText size={14} /> Enter manually
            </Action>
          </section>

          <aside className="min-w-0 space-y-5">
            <Panel className="space-y-4">
              <Pill tone="success">
                <ShieldCheck /> PRIVACY GUARANTEE
              </Pill>
              <h3 className="text-base font-medium tracking-tight">Zero Image Uploads</h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Text recognition runs directly inside your browser via local WebAssembly. The receipt image is decoded
                in memory and wiped after scanning. No server ever sees the photo.
              </p>
              <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground space-y-1.5">
                <p className="flex items-center gap-2">
                  <Check size={13} className="text-teal-500 shrink-0" /> JPEG, PNG, or WebP up to 10 MiB
                </p>
                <p className="flex items-center gap-2">
                  <Check size={13} className="text-teal-500 shrink-0" /> Full offline recognition
                </p>
                <p className="flex items-center gap-2">
                  <Check size={13} className="text-teal-500 shrink-0" /> Mandatory review before sharing
                </p>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

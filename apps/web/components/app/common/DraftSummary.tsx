"use client";

import type { ReactNode } from "react";
import { Check, Loader2, AlertCircle, RefreshCw, Receipt as ReceiptIcon } from "lucide-react";
import type { DraftSession } from "@/lib/types";
import { Action, Panel, StatePanel } from "./Primitives";

export interface DraftStateProps {
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

export function DraftState({ loading, error, onRetry }: DraftStateProps) {
  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <StatePanel
          busy
          title="Loading draft..."
          description="Retrieving draft records from local browser storage."
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <StatePanel
          tone="danger"
          title="Unable to load draft"
          description={error}
          action={
            onRetry ? (
              <Action variant="secondary" onClick={onRetry}>
                <RefreshCw size={14} /> Retry
              </Action>
            ) : undefined
          }
        />
      </div>
    );
  }

  return null;
}

export interface DraftSummaryProps {
  draft: DraftSession;
  saved?: boolean;
  saving?: boolean;
  error?: string | null;
  onRetry?: () => void;
  children?: ReactNode;
}

export function DraftSummary({
  draft,
  saved,
  saving,
  error,
  onRetry,
  children,
}: DraftSummaryProps) {
  const currency = draft.receipt.currency || "USD";
  const total = draft.receipt.total || "0.00";
  const subtotal = draft.receipt.subtotal || "0.00";
  const tax = draft.receipt.tax || "0.00";
  const itemCount = draft.receipt.items?.length ?? 0;
  const memberCount = draft.members.length + (draft.includeOrganiser ? 1 : 0);

  return (
    <Panel className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ReceiptIcon size={14} />
          <span>Receipt Summary</span>
        </div>
        <div>
          {saving ? (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> Saving...
            </span>
          ) : error ? (
            <button
              type="button"
              onClick={onRetry}
              className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
            >
              <AlertCircle size={12} /> Save failed · Retry
            </button>
          ) : saved ? (
            <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
              <Check size={12} /> Saved locally
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Total Bill
        </p>
        <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">
          {total} <span className="text-base font-normal text-muted-foreground">{currency}</span>
        </p>
      </div>

      <div className="rounded-2xl border border-border/60 bg-background/50 p-3.5 space-y-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-mono text-foreground">{subtotal} {currency}</span>
        </div>
        {parseFloat(tax) > 0 ? (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-mono text-foreground">{tax} {currency}</span>
          </div>
        ) : null}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Items</span>
          <span className="text-foreground">{itemCount} item{itemCount === 1 ? "" : "s"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Participants</span>
          <span className="text-foreground">{memberCount} {memberCount === 1 ? "person" : "people"}</span>
        </div>
      </div>

      {children ? <div className="space-y-3 pt-1">{children}</div> : null}
    </Panel>
  );
}

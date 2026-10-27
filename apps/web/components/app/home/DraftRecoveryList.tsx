"use client";

import Link from "next/link";
import { ClipboardList, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { deleteDraft, listDrafts, purgeOldDrafts } from "@/lib/draft";
import { formatUSDm, formatRelativeTime, microsFromDecimalString } from "@/lib/format";
import type { DraftSession } from "@/lib/types";
import { Action, Panel, Pill, StatePanel } from "../common/Primitives";

export function DraftRecoveryList() {
  const [drafts, setDrafts] = useState<DraftSession[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const deleteLock = useRef(false);

  const PREVIEW_LIMIT = 3;

  useEffect(() => {
    let cancelled = false;
    purgeOldDrafts(7)
      .catch(() => {})
      .finally(() => {
        listDrafts()
          .then((all) => {
            if (!cancelled) setDrafts(
              all
                .filter((d) => d.id && d.receipt?.total)
                .sort((a, b) => b.createdAt - a.createdAt)
            );
          })
          .catch(() => { if (!cancelled) setError("Couldn't read saved drafts on this device. Try again without closing this browser."); });
      });
    return () => { cancelled = true; };
  }, [attempt]);

  if (!drafts) return <StatePanel title={error ? "Your saved drafts could not be loaded." : "Your saved drafts are being loaded."} description={error ?? "We are checking this browser for unfinished splits so you can continue editing without starting again."} busy={!error} tone={error ? "danger" : "neutral"} action={error ? <Action variant="secondary" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>Try again</Action> : null} />;

  if (drafts.length === 0) {
    return (
      <Panel className="space-y-4"><span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><ClipboardList size={18} /></span><h2 className="text-xl font-medium tracking-tight">You have no saved drafts in this browser.</h2><p className="text-sm leading-relaxed text-muted-foreground">When you start a receipt, its saved draft will appear here. Drafts stay on this device, and older drafts may be cleared after seven days.</p></Panel>
    );
  }

  const remove = async (id: string) => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(true);
    setError(null);
    try {
      await deleteDraft(id);
      setDrafts((prev) => prev?.filter((d) => d.id !== id) ?? []);
    } catch { setError("Couldn't delete this draft. Please try again."); }
    finally { deleteLock.current = false; setDeleting(false); }
  };

  const clearAll = async () => {
    if (!drafts || deleteLock.current) return;
    if (!window.confirm(`Delete all ${drafts.length} saved drafts? This can't be undone.`)) return;
    deleteLock.current = true;
    setDeleting(true);
    setError(null);
    const results = await Promise.allSettled(drafts.map((draft) => deleteDraft(draft.id)));
    const failed = drafts.filter((_, index) => results[index].status === "rejected");
    setDrafts(failed);
    if (failed.length) setError("Some drafts couldn't be deleted. The remaining drafts are still shown below.");
    deleteLock.current = false;
    setDeleting(false);
  };

  return (
    <Panel className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-medium tracking-tight">Continue a draft you have already started.</h2>
        {drafts.length > 1 && (
          <button
            type="button"
            onClick={clearAll}
            disabled={deleting}
            className="min-h-11 rounded-full px-3 text-xs text-muted-foreground transition hover:text-destructive disabled:opacity-50"
          >
            Clear all
          </button>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{drafts.length} draft{drafts.length === 1 ? " is" : "s are"} saved in this browser. Drafts older than seven days may be cleared automatically.</p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ul className="flex flex-col gap-2">
        {(showAll ? drafts : drafts.slice(0, PREVIEW_LIMIT)).map((draft) => (
          <li
            key={draft.id}
            className="flex min-w-0 items-center gap-2 rounded-[24px] border border-border/70 bg-background/40 p-4"
          >
            <Link
              href={`/app/review/${draft.id}`}
              aria-label={`Resume draft for ${formatUSDm(microsFromDecimalString(draft.receipt.total))}`}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-[24px]"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="text-sm font-medium tabular-nums [overflow-wrap:anywhere]">
                    {formatUSDm(microsFromDecimalString(draft.receipt.total))}
                  </span>
                  <Pill className="px-2 py-1 text-[10px]">
                    {draft.mode}
                  </Pill>
                </div>
                {draft.receipt.items[0]?.name ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {draft.receipt.items[0].name}
                    {draft.receipt.items.length > 1 ? ` +${draft.receipt.items.length - 1} more` : ""}
                  </span>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {draft.members.length === 0 ? (
                    <span className="italic">No members added yet</span>
                  ) : (
                    `${draft.members.length} member${draft.members.length !== 1 ? "s" : ""}`
                  )}{" "}
                  · {draft.receipt.items.length} item{draft.receipt.items.length !== 1 ? "s" : ""} ·{" "}
                  {formatRelativeTime(draft.createdAt)}
                </span>
                <span className="mt-2 text-xs font-medium text-foreground">Resume draft &rarr;</span>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => remove(draft.id)}
              disabled={deleting}
              aria-label="Delete draft"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
      {drafts.length > PREVIEW_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="min-h-11 self-start rounded-full px-3 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {showAll ? "Show less" : `Show ${drafts.length - PREVIEW_LIMIT} more`}
        </button>
      )}
    </Panel>
  );
}

"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Address } from "@/lib/types";
import { shortAddress } from "@/lib/format";
import { cn } from "@/lib/utils";

export function AddressPill({
  address,
  className
}: {
  address: Address;
  className?: string;
}) {
  const [feedback, setFeedback] = useState<"copied" | "error" | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setFeedback("copied");
    } catch { setFeedback("error"); }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFeedback(null), 3000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
         "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/50 px-4 py-2 font-mono text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground",
        className
      )}
      aria-label={`Copy address ${address}`}
      title={address}
    >
      <span className="min-w-0 [overflow-wrap:anywhere]" aria-live="polite">{feedback === "copied" ? "Copied" : feedback === "error" ? "Copy failed. Try again" : shortAddress(address)}</span>
      {feedback === "copied" ? <Check size={14} className="shrink-0" /> : <Copy size={14} className="shrink-0" />}
    </button>
  );
}

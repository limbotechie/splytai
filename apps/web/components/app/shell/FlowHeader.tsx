"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Action } from "../common/Primitives";
import { cn } from "@/lib/utils";

const STEPS = ["scan", "review", "members", "split"] as const;
export type FlowStep = (typeof STEPS)[number];

interface Props {
  step: FlowStep;
  label?: string;
  onBack?: () => void | Promise<void>;
  busy?: boolean;
}

export function FlowHeader({ step, label, onBack, busy }: Props) {
  const router = useRouter();
  const idx = STEPS.indexOf(step);

  return (
    <header className="flex flex-col gap-4 border-b border-border/50 py-5 sm:gap-5 sm:py-6">
      <div className="flex items-center justify-between">
        <Action variant="ghost" onClick={() => { if (onBack) void onBack(); else router.back(); }} disabled={busy} className="-ml-3 px-3">
          <ArrowLeft /> Back
        </Action>
        <span className="text-xs font-medium text-muted-foreground">
          {label ?? `Step ${idx + 1} of 4`}
        </span>
      </div>
      <ol className="grid grid-cols-4 gap-1.5 sm:gap-3" aria-label="Create a split">
        {STEPS.map((value, index) => (
          <li key={value} aria-current={step === value ? "step" : undefined} className={cn("flex min-w-0 items-center justify-center gap-2 rounded-full px-2 py-2.5 text-xs sm:py-3 sm:text-sm", index === idx ? "bg-primary font-medium text-primary-foreground" : index < idx ? "bg-teal-500/10 text-teal-700 dark:text-teal-300" : "bg-muted/60 text-muted-foreground")}>
            <span className="hidden sm:inline-flex" aria-hidden>{index < idx ? <Check size={14} /> : `0${index + 1}`}</span>
            {["Receipt", "Review", "People", "Split"][index]}
          </li>
        ))}
      </ol>
    </header>
  );
}

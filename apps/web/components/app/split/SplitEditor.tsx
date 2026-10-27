"use client";

import { useId } from "react";
import { allocateBill } from "@/lib/bills/split";
import { currencyScale, formatDecimal } from "@/lib/bills/money";
import type { Allocation } from "@/lib/bills/types";
import type { DraftSession, SplitMode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { fieldClass, Pill } from "../common/Primitives";
import { draftBillDetails, draftMemberKeys, draftMemberLabel, ORGANISER_MEMBER_KEY } from "./draft-input";

const EXPIRY_OPTIONS = [
  { label: "1 day", value: 1440 },
  { label: "7 days", value: 10080 },
  { label: "14 days", value: 20160 },
  { label: "30 days", value: 43200 }
];

interface Props {
  draft: DraftSession;
  onChange: (next: DraftSession) => void;
}

export function SplitEditor({ draft, onChange }: Props) {
  const members = draftMemberKeys(draft);
  let scale = 2;
  let totalMinor = 0n;
  let sum = 0n;
  let allocations: Allocation[] = [];
  let allocationError: string | null = null;
  try {
    scale = currencyScale(draft.receipt.currency);
    const { receipt, participants } = draftBillDetails(draft);
    totalMinor = BigInt(receipt.totalMinor);
    sum = participants.reduce((total, person) => total + BigInt(person.customMinor), 0n);
    allocations = allocateBill(receipt, participants, draft.mode, "0");
  } catch (err) {
    allocationError = err instanceof Error ? err.message : "Review the receipt and assigned shares.";
  }
  const computed = new Map(allocations.map((allocation, index) => [members[index], BigInt(allocation.shareMinor)]));
  const formatAmount = (amount: bigint) => `${formatDecimal(amount, scale)} ${draft.receipt.currency}`;

  const setMode = (mode: SplitMode) => {
    if (mode === draft.mode) return;
    if (mode === "custom" && allocations.length) {
      onChange({
        ...draft,
        mode,
        amounts: draft.members.map((name) => formatDecimal(computed.get(name) ?? 0n, scale)),
        organiserCustomAmount: formatDecimal(computed.get(ORGANISER_MEMBER_KEY) ?? 0n, scale),
      });
    } else {
      onChange({ ...draft, mode });
    }
  };

  const setCustomAmount = (name: string, value: string) => {
    if (name === ORGANISER_MEMBER_KEY) {
      onChange({ ...draft, organiserCustomAmount: value });
      return;
    }
    const idx = draft.members.indexOf(name);
    const next = [...(draft.amounts.length === draft.members.length
      ? draft.amounts
      : draft.members.map(() => ""))];
    next[idx] = value;
    onChange({ ...draft, amounts: next });
  };

  const setAssignments = (assignments: Record<number, string[]>) => {
    onChange({ ...draft, assignments });
  };

  const setExpiry = (value: number) => {
    onChange({ ...draft, expiresInMinutes: value });
  };

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex min-w-0 flex-col gap-4">
        <h2 className="text-xl font-medium tracking-tight">Select the method that matches your agreement.</h2>
        <div className="flex flex-wrap gap-1 rounded-full border border-border/70 bg-background/50 p-1" aria-label="Split method">
          {(["equal", "itemised", "custom"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              aria-pressed={draft.mode === mode}
              className={cn(
                "min-h-11 min-w-0 flex-1 rounded-full px-3 py-2 text-sm capitalize transition",
                draft.mode === mode
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {mode}
            </button>
          ))}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">{draft.mode === "equal" ? "The bill is divided equally among all participants. Small rounding differences are assigned automatically so the shares add up to the receipt total." : draft.mode === "itemised" ? "Select the people who will share each receipt item. Tax and tip are allocated proportionally to their item shares. Receipt arithmetic must match the total." : "Enter the amount agreed for each participant. The combined amounts must match the receipt total before you can create the split."}</p>
      </div>

      {draft.mode === "itemised" && members.length > 0 ? (
        <ItemAssignmentSection
          receipt={draft.receipt}
          members={members}
          assignments={draft.assignments ?? {}}
          onChange={setAssignments}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Time to pay</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">Payment links expire after this time, measured from creation.</p>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setExpiry(option.value)}
              aria-pressed={draft.expiresInMinutes === option.value}
              className={cn(
                "min-h-11 min-w-14 whitespace-nowrap rounded-full border border-border/70 bg-background/40 px-4 py-2 text-sm transition",
                draft.expiresInMinutes === option.value
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-border/70 bg-background/40 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            Per-member ({members.length})
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            Total {draft.receipt.total} {draft.receipt.currency}
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-border/40">
          {members.map((name) => (
            <li key={name} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm [overflow-wrap:anywhere]" title={draftMemberLabel(name)}>{draftMemberLabel(name)}</span>
              </div>
              {draft.mode === "custom" ? (
                <CustomAmountInput
                  label={`Amount for ${draftMemberLabel(name)}`}
                  currency={draft.receipt.currency}
                  value={
                    (name === ORGANISER_MEMBER_KEY ? draft.organiserCustomAmount : draft.amounts[draft.members.indexOf(name)]) ?? ""
                  }
                  onChange={(value) => setCustomAmount(name, value)}
                />
              ) : (
                <span className="text-sm font-medium tabular-nums [overflow-wrap:anywhere]">
                  {computed.has(name) ? formatAmount(computed.get(name)!) : "Not calculated"}
                </span>
              )}
            </li>
          ))}
        </ul>
        {draft.mode === "custom" ? (
          <p role="status"
            className={cn(
              "text-sm leading-relaxed",
              sum === totalMinor && !allocationError ? "text-muted-foreground" : "text-destructive"
            )}
          >
            {allocationError ?? (sum === totalMinor ? `The assigned shares add up to ${formatAmount(sum)}, which matches the receipt total.` : sum < totalMinor ? `You still need to assign ${formatAmount(totalMinor - sum)} before the shares match the receipt total.` : `The shares exceed the receipt total by ${formatAmount(sum - totalMinor)}. Reduce one or more amounts before continuing.`)}
          </p>
        ) : null}
        {draft.mode !== "custom" && allocationError ? <p role="alert" className="text-sm text-destructive">{allocationError}</p> : null}
      </div>
    </div>
  );
}

interface ItemAssignmentSectionProps {
  receipt: DraftSession["receipt"];
  members: string[];
  assignments: Record<number, string[]>;
  onChange: (next: Record<number, string[]>) => void;
}

function ItemAssignmentSection({ receipt, members, assignments, onChange }: ItemAssignmentSectionProps) {
  const toggleMember = (itemIdx: number, addr: string) => {
    const current = assignments[itemIdx]?.length > 0 ? [...assignments[itemIdx]] : [...members];
    const pos = current.indexOf(addr);
    const next = pos !== -1 ? current.filter((a) => a !== addr) : [...current, addr];
    if (next.length === 0) return; // must keep at least one assignee per item
    const isAll = members.length === next.length && members.every((m) => next.includes(m));
    onChange({ ...assignments, [itemIdx]: isAll ? [] : next });
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Assign items</span>
      <ul className="flex flex-col gap-2">
        {receipt.items.map((item, idx) => (
          <li
            key={idx}
            className="flex min-w-0 flex-col gap-4 rounded-[24px] border border-border/70 bg-background/40 p-4 sm:p-5"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm [overflow-wrap:anywhere]">{item.name}</span>
              <span className="text-xs font-medium text-muted-foreground [overflow-wrap:anywhere]">
                {item.amount} {receipt.currency}
              </span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2">
              {members.map((addr) => {
                const assigned = assignments[idx]?.length > 0 ? assignments[idx] : null;
                const active = !assigned || assigned.includes(addr);
                const chipLabel = draftMemberLabel(addr);
                return (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => toggleMember(idx, addr)}
                    aria-pressed={active}
                    title={chipLabel}
                    className={cn(
                      "min-h-11 max-w-full rounded-full border px-4 py-2 text-xs transition [overflow-wrap:anywhere]",
                      active
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border/40 bg-muted text-muted-foreground"
                    )}
                  >
                    {chipLabel}
                  </button>
                );
              })}
            </div>
            <Pill className="self-start text-[11px]">Keep at least one person per item</Pill>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomAmountInput({
  label,
  currency,
  value,
  onChange
}: {
  label: string;
  currency: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = useId();
  return (
    <div className="relative w-36 min-w-0 max-w-full">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden>{currency === "USD" ? "$" : currency}</span>
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9.]/g, "");
          if (!/^\d{0,12}(\.\d{0,6})?$/.test(next)) return;
          onChange(next === "." ? "0." : next);
        }}
        className={cn(fieldClass, currency === "USD" ? "pl-8" : "pl-12", "text-right tabular-nums")}
      />
    </div>
  );
}

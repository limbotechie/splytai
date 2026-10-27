"use client";

import { Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { formatUSDm, microsFromDecimalString, microsToDecimalString } from "@/lib/format";
import type { ParsedReceipt, ReceiptItem } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Action, fieldClass } from "../common/Primitives";

interface Props {
  receipt: ParsedReceipt;
  onChange: (next: ParsedReceipt) => void;
}

export function ReviewEditor({ receipt, onChange }: Props) {
  const updateItem = (idx: number, patch: Partial<ReceiptItem>) => {
    const items = receipt.items.map((item, i) => (i === idx ? { ...item, ...patch } : item));
    onChange({ ...receipt, items });
  };

  const removeItem = (idx: number) => {
    const items = receipt.items.filter((_, i) => i !== idx);
    onChange({ ...receipt, items });
  };

  const addItem = () => {
    onChange({
      ...receipt,
      items: [...receipt.items, { name: "Item", amount: "0.000000" }]
    });
  };

  const setTotals = (patch: Partial<Pick<ParsedReceipt, "subtotal" | "tax" | "total">>) => {
    onChange({ ...receipt, ...patch });
  };

  const sum = useMemo(() => {
    return receipt.items.reduce(
      (acc, item) => acc + microsFromDecimalString(item.amount),
      0n
    );
  }, [receipt.items]);

  const totalMicros = microsFromDecimalString(receipt.total);
  const mismatch = sum + microsFromDecimalString(receipt.tax || "0") !== totalMicros;

  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center justify-between gap-2"><h2 className="text-xl font-medium tracking-tight">The line items</h2><span className="text-xs text-muted-foreground">{receipt.items.length} items</span></div>
        <ul className="flex min-w-0 flex-col gap-3">
          {receipt.items.map((item, idx) => (
            <li
              key={idx}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_44px] items-end gap-3 rounded-[24px] border border-border/60 bg-background/40 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(90px,130px)_44px]"
            >
              <label className="col-span-2 min-w-0 space-y-2 sm:col-span-1"><span className="block text-xs text-muted-foreground">Item {idx + 1}</span>
              <input
                value={item.name}
                onChange={(e) => updateItem(idx, { name: e.target.value.slice(0, 200) })}
                className={fieldClass}
                placeholder="Item name"
                maxLength={200}
              />
              </label>
              <AmountInput
                label={`Item ${idx + 1} amount`}
                value={item.amount}
                onChange={(value) => updateItem(idx, { amount: value })}
              />
              <Action
                variant="ghost"
                aria-label={`Remove item ${idx + 1}`}
                onClick={() => removeItem(idx)}
                className="size-11 p-0 hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 size={14} />
              </Action>
            </li>
          ))}
        </ul>
        <Action
          variant="secondary"
          onClick={addItem}
          className="self-start border-dashed"
        >
          + Add item
        </Action>
      </div>

      <div className="flex flex-col gap-4 border-t border-border/70 pt-6">
        <h2 className="text-xl font-medium tracking-tight">Check the totals</h2>
        <TotalsRow
          label="Subtotal"
          value={receipt.subtotal}
          onChange={(v) => setTotals({ subtotal: v })}
        />
        <TotalsRow label="Tax" value={receipt.tax} onChange={(v) => setTotals({ tax: v })} />
        <TotalsRow
          label="Total"
          value={receipt.total}
          onChange={(v) => setTotals({ total: v })}
          emphasised
        />
        {mismatch ? (
          <p role="status" className="rounded-[24px] bg-orange-500/10 p-4 text-sm leading-relaxed text-orange-800 dark:text-orange-300">
            Items plus tax don&apos;t match the total. Check the receipt: we split the total you enter, not the sum of the items.
          </p>
        ) : null}
      </div>

      {totalMicros === 0n ? (
        <p role="status" className="rounded-[24px] bg-destructive/10 p-4 text-sm text-destructive">
          The total is $0.00. Enter the bill total before creating a split.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          The items add up to {formatUSDm(sum)}. Splyt divides the final total you enter, including any tax or adjustments shown on the receipt.
        </p>
      )}
    </div>
  );
}

function TotalsRow({
  label,
  value,
  onChange,
  emphasised
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  emphasised?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span aria-hidden className={cn("text-sm", emphasised ? "font-medium" : "text-muted-foreground")}>
        {label}
      </span>
      <div className="w-36 min-w-0"><AmountInput label={label} value={value} onChange={onChange} emphasised={emphasised} hideLabel /></div>
    </div>
  );
}

function AmountInput({
  label,
  value,
  onChange,
  emphasised,
  hideLabel
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  emphasised?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState("");
  const display = (() => {
    try {
      return microsToDecimalString(microsFromDecimalString(value)).replace(/0+$/, "").replace(/\.$/, ".00");
    } catch {
      return value;
    }
  })();

  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={id} className={hideLabel ? "sr-only" : "block text-xs text-muted-foreground"}>{label}</label>
      <div className="relative min-w-0"><span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden>$</span>
      <input
        id={id}
        inputMode="decimal"
        value={editing ? input : display}
        onFocus={() => { setEditing(true); setInput(display); }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          const next = e.target.value.replace(/[^0-9.]/g, "");
          if (!/^\d{0,12}(\.\d{0,6})?$/.test(next)) return;
          setInput(next);
          onChange(!next || next === "." ? "0.000000" : next);
        }}
        className={cn(
          fieldClass, "pl-8 text-right font-mono tabular-nums",
          emphasised && "font-medium"
        )}
      />
      </div>
    </div>
  );
}

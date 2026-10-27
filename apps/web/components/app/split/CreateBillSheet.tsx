"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { useWorkspace } from "@/context/WorkspaceContext";
import { createBill } from "@/lib/workflow/bill";
import { deleteDraft } from "@/lib/draft";
import type { DraftSession } from "@/lib/types";
import type {
  ApprovedConversion,
  CreateBillManifestInput,
} from "@/lib/bills/types";
import { AppDialog } from "../common/AppDialog";
import { Action, Pill } from "../common/Primitives";
import { formatZec } from "@/lib/bills/money";
import { validateAddress } from "@/lib/zcash/address";
import { draftBillDetails, draftConversionZatoshis, draftMemberKeys } from "./draft-input";

interface Props {
  draft: DraftSession;
  open: boolean;
  onClose: () => void;
  receivingAddress: string;
  conversionQuote: ApprovedConversion | null;
  expiryDays: number;
}

export function CreateBillSheet({
  draft,
  open,
  onClose,
  receivingAddress,
  conversionQuote,
  expiryDays,
}: Props) {
  const router = useRouter();
  const { relay, network } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [createdBillId, setCreatedBillId] = useState<string | null>(null);

  const handleCreate = async () => {
    if (busy || !reviewed || createdBillId) return;
    setError(null);
    setBusy(true);

    try {
      const cleanAddress = receivingAddress.trim();
      if (!cleanAddress) {
        throw new Error("Please enter your shielded Zcash receiving address.");
      }

      const receiving = await validateAddress(cleanAddress, "testnet");

      if (!conversionQuote) {
        throw new Error("Please approve a ZEC conversion rate before creating the bill.");
      }

      const { receipt, participants } = draftBillDetails(draft);
      const approvedAmount = draftConversionZatoshis(
        draft, conversionQuote.source, conversionQuote.quote, formatZec(conversionQuote.wholeBillZatoshis),
      );
      if (approvedAmount !== conversionQuote.wholeBillZatoshis) {
        throw new Error("The receipt total changed. Return to the editor and approve the conversion again.");
      }

      const input: CreateBillManifestInput = {
        title: receipt.title,
        receipt,
        participants,
        mode: draft.mode === "custom" ? "custom" : draft.mode === "itemised" ? "itemised" : "equal",
        conversion: conversionQuote,
        receiving,
        includeDetails: true,
        expiryDays,
      };

      const created = await createBill(relay, input);
      setCreatedBillId(created.billId);

      try {
        await deleteDraft(draft.id);
      } catch {
        setError("Your bill was created, but the original draft could not be removed. It is preserved in this browser; open the created bill instead of creating it again.");
        setBusy(false);
        return;
      }

      // Navigate to the newly created bill page
      router.push(`/app/bills/${created.billId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create bill. Check parameters.");
      setBusy(false);
    }
  };

  return (
    <AppDialog open={open} onClose={() => (!busy ? onClose() : undefined)}>
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Pill tone="success">
              <ShieldCheck size={14} /> ZERO-KNOWLEDGE RELAY
            </Pill>
            <Pill tone="info" className="uppercase">
              {network}
            </Pill>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Create Private Bill</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            The bill manifest will be signed with a new P-256 key and encrypted with AES-256-GCM.
            Only the blind encrypted envelope is stored on the relay.
          </p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/60 p-4 space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Whole Bill Total</span>
            <span className="font-mono font-semibold text-foreground">
              {conversionQuote ? `${formatZec(conversionQuote.wholeBillZatoshis)} ZEC` : "Not approved"}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Participants</span>
            <span className="font-medium text-foreground">
              {draftMemberKeys(draft).length} people
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Expiry</span>
            <span className="font-medium text-foreground">
              {expiryDays} days
            </span>
          </div>
          <div className="border-t border-border/50 pt-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Receiving Shielded Address</span>
            <span className="font-mono text-[11px] truncate text-foreground">
              {receivingAddress || "None entered"}
            </span>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <input type="checkbox" checked={reviewed} disabled={busy || Boolean(createdBillId)} onChange={(event) => setReviewed(event.target.checked)} className="mt-0.5" />
          I reviewed the receipt, participant shares, conversion, and testnet receiving address. Create the bill with these amounts.
        </label>

        {error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Action
            onClick={createdBillId ? () => router.push(`/app/bills/${createdBillId}`) : handleCreate}
            disabled={busy || (!createdBillId && (!reviewed || !receivingAddress || !conversionQuote))}
            className="w-full"
          >
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Reserving on relay & encrypting...
              </>
            ) : (
              createdBillId ? "Open Created Bill" : "Confirm & Create Bill"
            )}
          </Action>
          <Action
            variant="ghost"
            onClick={onClose}
            disabled={busy}
            className="w-full text-xs"
          >
            Back to editor
          </Action>
        </div>
      </div>
    </AppDialog>
  );
}

import type { DraftSession } from "@/lib/types";
import type { ApprovedConversion, Participant, Receipt } from "@/lib/bills/types";
import { currencyScale, MAX_ZATOSHIS, parseDecimal } from "@/lib/bills/money";
import { suggestZatoshis, validateQuote, type RateQuote } from "@/lib/rates";

export const ORGANISER_MEMBER_KEY = "\u0000organiser";

export function draftMemberKeys(draft: DraftSession): string[] {
  return draft.includeOrganiser ? [ORGANISER_MEMBER_KEY, ...draft.members] : draft.members;
}

export function draftMemberLabel(key: string): string {
  return key === ORGANISER_MEMBER_KEY ? "You (Organiser)" : key;
}

export function draftAmountMinor(value: string, scale: number): bigint {
  // Older drafts store six decimals; discard only redundant zeros, never round user amounts.
  return parseDecimal(value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""), scale);
}

export function draftConversionZatoshis(
  draft: DraftSession,
  source: ApprovedConversion["source"],
  quote: RateQuote | null,
  manualZec: string,
  now = Date.now(),
): string {
  const scale = currencyScale(draft.receipt.currency);
  const total = draftAmountMinor(draft.receipt.total, scale);
  if (total <= 0n) throw new Error("Enter a positive receipt total before approving a conversion.");
  let amount: bigint;
  if (source === "coingecko") {
    if (!quote) throw new Error("A live rate is unavailable. Refresh it or explicitly enter a manual ZEC total.");
    validateQuote(quote, draft.receipt.currency, now);
    amount = BigInt(suggestZatoshis(total.toString(), scale, quote, now));
  } else {
    if (quote) throw new Error("A manual conversion cannot use a market quote.");
    if (!manualZec) throw new Error("Enter the whole-bill ZEC total you have agreed manually.");
    amount = parseDecimal(manualZec, 8, MAX_ZATOSHIS);
  }
  if (amount <= 0n) throw new Error("Approve a positive whole-bill ZEC amount.");
  return amount.toString();
}

export function draftBillDetails(draft: DraftSession): { receipt: Receipt; participants: Participant[] } {
  const scale = currencyScale(draft.receipt.currency);
  if (new Set(draft.members).size !== draft.members.length || draft.members.includes(ORGANISER_MEMBER_KEY)) {
    throw new Error("Review the participant names before creating the bill.");
  }
  const participants: Participant[] = draft.members.map((label, index) => ({
    id: `participant-${index + 1}`,
    label,
    isOrganiser: false,
    customMinor: draft.mode === "custom" ? draftAmountMinor(draft.amounts[index] || "0", scale).toString() : "0",
  }));
  if (draft.includeOrganiser) {
    participants.unshift({
      id: "organiser",
      label: draftMemberLabel(ORGANISER_MEMBER_KEY),
      isOrganiser: true,
      customMinor: draft.mode === "custom" ? draftAmountMinor(draft.organiserCustomAmount || "0", scale).toString() : "0",
    });
  }
  const idsByMember = new Map(draftMemberKeys(draft).map((key, index) => [key, participants[index].id]));
  const receipt: Receipt = {
    title: draft.receipt.title?.trim() ?? "",
    currency: draft.receipt.currency,
    scale,
    reviewed: true,
    items: draft.receipt.items.map((item, index) => {
      const assigned = draft.assignments?.[index];
      const assignees = assigned?.length ? assigned : draftMemberKeys(draft);
      return {
        id: `item-${index + 1}`,
        label: item.name,
        amountMinor: draftAmountMinor(item.amount, scale).toString(),
        assigneeIds: draft.mode === "itemised" ? assignees.map((key) => {
          const id = idsByMember.get(key);
          if (!id) throw new Error(`Review the participants assigned to "${item.name}".`);
          return id;
        }) : [],
      };
    }),
    taxMinor: draftAmountMinor(draft.receipt.tax || "0", scale).toString(),
    tipMinor: draftAmountMinor(draft.receipt.tip || "0", scale).toString(),
    discountMinor: "0",
    totalMinor: draftAmountMinor(draft.receipt.total, scale).toString(),
  };
  return { receipt, participants };
}

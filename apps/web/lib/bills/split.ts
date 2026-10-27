import { currencyScale, distribute, integer, MAX_ZATOSHIS, parseDecimal } from "./money";
import type { Allocation, Draft, Participant, Receipt, SplitMode } from "./types";

export function validateReceipt(receipt: Receipt): void {
  if (!receipt || !receipt.reviewed) throw new Error("Review the receipt, items, currency and totals before continuing.");
  if (!receipt.title.trim() || receipt.title.length > 120) throw new Error("Use a bill title between 1 and 120 characters.");
  if (currencyScale(receipt.currency) !== receipt.scale) throw new Error("The receipt currency and decimal precision do not match.");
  if (!Array.isArray(receipt.items) || receipt.items.length > 100) throw new Error("A bill supports up to 100 line items.");
  if (new Set(receipt.items.map((item) => item.id)).size !== receipt.items.length) throw new Error("Each receipt item needs its own identifier.");
  const total = integer(receipt.totalMinor);
  const tax = integer(receipt.taxMinor);
  const tip = integer(receipt.tipMinor);
  const discount = integer(receipt.discountMinor);
  const subtotal = receipt.items.reduce((sum, item) => {
    if (!item.id || !item.label.trim() || item.label.length > 160) throw new Error("Review every line item description.");
    return sum + integer(item.amountMinor);
  }, 0n);
  if (receipt.items.length && subtotal + tax + tip - discount !== total) {
    throw new Error("Items plus tax and tip, minus discounts, must equal the receipt total. Correct unexplained differences.");
  }
  if (!receipt.items.length && (tax !== 0n || tip !== 0n || discount !== 0n)) {
    throw new Error("Add the original expense as a line item before entering adjustments.");
  }
}

export function validateParticipants(participants: Participant[]): void {
  if (!Array.isArray(participants) || participants.length < 1 || participants.length > 50) throw new Error("A bill needs between 1 and 50 people, including your share if applicable.");
  if (new Set(participants.map((person) => person.id)).size !== participants.length || participants.some((person) => !person.id || !person.label.trim() || person.label.length > 60)) {
    throw new Error("Each person needs a unique identifier and a label of up to 60 characters.");
  }
  if (participants.filter((person) => person.isOrganiser).length > 1) throw new Error("Only one share can belong to the organiser.");
}

export function allocateBill(receipt: Receipt, participants: Participant[], mode: SplitMode, wholeBillZatoshis: string): Allocation[] {
  validateReceipt(receipt);
  validateParticipants(participants);
  const total = integer(receipt.totalMinor);
  const zatoshis = integer(wholeBillZatoshis, MAX_ZATOSHIS);
  const zero = () => new Map(participants.map((person) => [person.id, 0n]));
  let subtotal = zero();
  let tax = zero();
  let tip = zero();
  let discount = zero();
  if (mode === "equal") {
    subtotal = distribute(total, participants.map((person) => ({ id: person.id, weight: 1n })));
  } else if (mode === "custom") {
    subtotal = new Map(participants.map((person) => [person.id, integer(person.customMinor)]));
    if ([...subtotal.values()].reduce((sum, amount) => sum + amount, 0n) !== total) throw new Error("Custom shares must add up exactly to the complete receipt total.");
  } else if (mode === "itemised") {
    if (!receipt.items.length) throw new Error("Itemised splitting needs at least one reviewed line item.");
    for (const item of receipt.items) {
      if (!Array.isArray(item.assigneeIds) || !item.assigneeIds.length || new Set(item.assigneeIds).size !== item.assigneeIds.length || item.assigneeIds.some((id) => !subtotal.has(id))) {
        throw new Error(`Assign every item explicitly, including "${item.label}".`);
      }
      const shares = distribute(integer(item.amountMinor), item.assigneeIds.map((id) => ({ id, weight: 1n })));
      for (const [id, amount] of shares) subtotal.set(id, subtotal.get(id)! + amount);
    }
    const weights = participants.map((person) => ({ id: person.id, weight: subtotal.get(person.id)! }));
    tax = distribute(integer(receipt.taxMinor), weights);
    tip = distribute(integer(receipt.tipMinor), weights);
    discount = distribute(integer(receipt.discountMinor), weights);
  } else {
    throw new Error("Choose equal, custom or itemised allocations.");
  }
  const shares = participants.map((person) => ({ id: person.id, weight: subtotal.get(person.id)! + tax.get(person.id)! + tip.get(person.id)! - discount.get(person.id)! }));
  if (shares.some((share) => share.weight < 0n)) throw new Error("An adjustment would make a person's net share negative. Correct the receipt or allocations.");
  if (shares.reduce((sum, share) => sum + share.weight, 0n) !== total) throw new Error("The reviewed allocations do not equal the whole bill.");
  const converted = distribute(zatoshis, shares);
  return participants.map((person, index) => ({
    participantId: person.id,
    subtotalMinor: subtotal.get(person.id)!.toString(),
    taxMinor: tax.get(person.id)!.toString(),
    tipMinor: tip.get(person.id)!.toString(),
    discountMinor: discount.get(person.id)!.toString(),
    shareMinor: shares[index].weight.toString(),
    zatoshis: converted.get(person.id)!.toString(),
    isOrganiser: person.isOrganiser,
  }));
}

export function receiptFromDraft(draft: Draft): Receipt {
  const scale = currencyScale(draft.currency);
  const minor = (value: string) => parseDecimal(value || "0", scale).toString();
  return {
    title: draft.title.trim(), currency: draft.currency, scale, reviewed: draft.reviewed,
    items: draft.items.map((item) => ({ id: item.id, label: item.label.trim(), amountMinor: minor(item.amount), assigneeIds: item.assigneeIds })),
    totalMinor: minor(draft.total), taxMinor: minor(draft.tax), tipMinor: minor(draft.tip), discountMinor: minor(draft.discount),
  };
}

export function participantsFromDraft(draft: Draft): Participant[] {
  const scale = currencyScale(draft.currency);
  return draft.participants.map((person) => ({ id: person.id, label: person.label.trim(), isOrganiser: person.isOrganiser, customMinor: parseDecimal(person.customAmount || "0", scale).toString() }));
}

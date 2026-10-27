import { formatZec, integer, MAX_ZATOSHIS } from "../bills/money";
import type { ShieldedAddress } from "./address";

export function createReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `splyt-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function paymentUri(receiver: ShieldedAddress, amountZatoshis: string, reference: string): string {
  if (receiver.network !== "testnet") throw new Error("Wallet handoff is supported on testnet only.");
  const amount = integer(amountZatoshis, MAX_ZATOSHIS);
  if (amount === 0n) throw new Error("A zero-value share does not create a payable request.");
  if (!/^splyt-[a-f0-9]{32}$/.test(reference)) throw new Error("Invalid request reference.");
  if (!receiver.receivers.length || receiver.receivers.some((receiver) => receiver !== "sapling" && receiver !== "orchard") ||
    !/^(?:ztestsapling1|utest1)[a-z0-9]+$/.test(receiver.address)) throw new Error("Validate a shielded testnet receiving address first.");
  const bytes = new TextEncoder().encode(reference);
  if (bytes.byteLength > 512) throw new Error("The memo exceeds the shielded memo limit.");
  const memo = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `zcash:${receiver.address}?amount=${formatZec(amount)}&memo=${memo}`;
}

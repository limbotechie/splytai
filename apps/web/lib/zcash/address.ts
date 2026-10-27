import type { Network, ReceivingDetails } from "../bills/types";

export type ShieldedAddress = ReceivingDetails;

export interface AddressParser {
  is_valid_zcash_address(address: string): boolean;
  normalize_zcash_address(address: string): string;
  get_zcash_address_type(address: string): string;
  get_address_receivers(address: string): unknown;
}

const RECEIVER_KEYS = ["p2pkh", "p2sh", "sapling", "orchard", "tex"] as const;

function encodedLength(canonical: string): number {
  const separator = canonical.lastIndexOf("1");
  if (separator < 1) throw new Error("Enter a complete Zcash address with a valid checksum.");
  // Bech32/Bech32m carry six checksum characters; the rest is the data part.
  return canonical.length - separator - 1 - 6;
}

function networkOf(address: string): Network | null {
  if (/^(ztestsapling1|utest1)/.test(address)) return "testnet";
  if (/^(zs1|u1)/.test(address)) return "mainnet";
  return null;
}

/**
 * Validates a receiving address with the Rust-backed parser. Only shielded-only
 * addresses are accepted: transparent fallback and unrecognised future receivers
 * are rejected rather than silently ignored.
 */
export function inspectAddress(input: string, network: Network, parser: AddressParser): ShieldedAddress {
  if (typeof input !== "string") throw new Error("Enter a complete Zcash address with a valid checksum.");
  const address = input.trim();
  if (!/^[A-Za-z0-9]{20,512}$/.test(address) || !parser.is_valid_zcash_address(address)) {
    throw new Error("Enter a complete Zcash address with a valid checksum.");
  }
  const canonical = parser.normalize_zcash_address(address);
  if (typeof canonical !== "string" || canonical !== address) {
    throw new Error("Use the wallet's canonical address without extra text.");
  }
  const type = parser.get_zcash_address_type(canonical);
  if (type !== "sapling" && type !== "unified") {
    throw new Error("Use a shielded Sapling or shielded-only Unified Address. Transparent addresses are not accepted.");
  }
  if (networkOf(canonical) !== network) throw new Error(`The receiving address must be for ${network}.`);

  const value = parser.get_address_receivers(canonical);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The receiving address format is not supported.");
  const receivers = value as Record<string, unknown>;
  if (Object.keys(receivers).some((key) => !RECEIVER_KEYS.includes(key as (typeof RECEIVER_KEYS)[number]))) {
    throw new Error("This address uses an unsupported receiver format.");
  }
  if (receivers.p2pkh || receivers.p2sh || receivers.tex) {
    throw new Error("This address permits transparent or legacy fallback. Ask your wallet for a shielded-only address.");
  }
  const shielded = (["sapling", "orchard"] as const).filter((name) => typeof receivers[name] === "string" && Boolean(receivers[name]));
  if (!shielded.length) throw new Error("No supported shielded receiver was found.");
  if (type === "sapling" && (shielded.length !== 1 || shielded[0] !== "sapling")) {
    throw new Error("The Sapling address contains an unexpected receiver.");
  }
  if (type === "unified") {
    // Parser 0.2.0 omits receivers it does not know. Each known shielded receiver
    // adds a 1-byte typecode, a 1-byte length and a 43-byte encoding. ZIP 316 then
    // appends sixteen bytes of HRP padding. Extra bytes mean an unknown receiver.
    const expected = Math.ceil((45 * shielded.length + 16) * 8 / 5);
    if (encodedLength(canonical) !== expected) {
      throw new Error("This Unified Address contains an unsupported receiver.");
    }
  }
  return { address: canonical, network, type, receivers: shielded };
}

export async function validateAddress(address: string, network: Network): Promise<ShieldedAddress> {
  const parser = await import("@elemental-zcash/zaddr_wasm_parser");
  return inspectAddress(address, network, parser);
}

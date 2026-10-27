import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReference, paymentUri } from "./uri";
import type { ShieldedAddress } from "./address";
import { installCrypto } from "../private-workspace/test-support";

const MAINNET_SAPLING = "zs1jap4fpzz4wj0uh7zavxsju6xrqud6gdkelx4gng8h0t30qv5huz6ar4hpvsxr6tdvza9zasweve";
const TESTNET_SAPLING = "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez";

const receiver: ShieldedAddress = {
  address: TESTNET_SAPLING,
  network: "testnet",
  type: "sapling",
  receivers: ["sapling"],
};

function memoOf(uri: string): string {
  const match = /[?&]memo=([A-Za-z0-9_-]+)/.exec(uri);
  if (!match) throw new Error("missing memo");
  return match[1];
}

function decode(value: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
}

describe("ZIP 321 payment URIs", () => {
  beforeEach(() => installCrypto());
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("builds an exact decimal amount and a base64url request reference in the memo", () => {
    const reference = "splyt-0123456789abcdef0123456789abcdef";
    const uri = paymentUri(receiver, "123456789", reference);
    expect(uri).toBe(`zcash:${TESTNET_SAPLING}?amount=1.23456789&memo=${memoOf(uri)}`);
    expect(memoOf(uri)).not.toContain("+");
    expect(memoOf(uri)).not.toContain("=");
    expect(memoOf(uri)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(memoOf(uri))).toBe(reference);
  });

  it("keeps the smallest unit without scientific notation or trailing zeros", () => {
    expect(paymentUri(receiver, "1", "splyt-ffffffffffffffffffffffffffffffff"))
      .toContain("amount=0.00000001");
    expect(paymentUri(receiver, "100000000", "splyt-ffffffffffffffffffffffffffffffff"))
      .toContain("amount=1.00000000");
  });

  it("accepts a testnet shielded receiver", () => {
    const uri = paymentUri({ ...receiver, address: TESTNET_SAPLING, network: "testnet" }, "5", "splyt-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(uri.startsWith(`zcash:${TESTNET_SAPLING}?amount=0.00000005&memo=`)).toBe(true);
  });

  it("rejects mainnet and misleading network labels", () => {
    const reference = "splyt-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    expect(() => paymentUri({ ...receiver, address: MAINNET_SAPLING, network: "mainnet" }, "5", reference)).toThrow(/testnet/);
    expect(() => paymentUri({ ...receiver, address: MAINNET_SAPLING }, "5", reference)).toThrow(/testnet/);
  });

  it("creates unique, fragment-safe references", () => {
    const first = createReference();
    const second = createReference();
    expect(first).toMatch(/^splyt-[0-9a-f]{32}$/);
    expect(second).toMatch(/^splyt-[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
  });

  it("rejects zero, malformed and over-limit amounts", () => {
    for (const amount of ["0", "-1", "1.5", "01", "", "2100000000000001"]) {
      expect(() => paymentUri(receiver, amount, "splyt-0123456789abcdef0123456789abcdef")).toThrow();
    }
    expect(paymentUri(receiver, "2100000000000000", "splyt-0123456789abcdef0123456789abcdef")).toContain("amount=21000000.00000000");
  });

  it("rejects references that are not Splyt request references", () => {
    for (const reference of ["splyt-", "splyt-0123", `splyt-${"A".repeat(32)}`, `splyt-${"0".repeat(33)}`, "other-0123456789abcdef0123456789abcdef"]) {
      expect(() => paymentUri(receiver, "1", reference)).toThrow(/reference/);
    }
  });

  it("requires a validated shielded receiver", () => {
    expect(() => paymentUri({ ...receiver, receivers: [] }, "1", "splyt-0123456789abcdef0123456789abcdef")).toThrow(/Validate/);
    expect(() => paymentUri({ ...receiver, address: `${TESTNET_SAPLING}?x=1` }, "1", "splyt-0123456789abcdef0123456789abcdef")).toThrow(/Validate/);
  });
});

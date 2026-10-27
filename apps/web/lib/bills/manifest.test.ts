import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertPayableParticipant, createBillManifest, payableAllocations, validateBillManifest,
} from "./manifest";
import type { BillManifest } from "./types";
import { randomSecret, randomId } from "../private-workspace/crypto";
import { installCrypto } from "../private-workspace/test-support";
import {
  ALICE, BILL_ID, MAINNET_SAPLING, TESTNET_SAPLING, NOW, ORGANISER, manifestFixture, participants, receipt, snapshot,
} from "../requests/__tests__/fixtures";

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function hexReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `splyt-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: randomId(),
    obligationId: randomId(),
    participantId: ALICE,
    participantLabel: "Alice",
    reference: hexReference(),
    contentKey: randomSecret(),
    readCapability: randomSecret(),
    reportCapability: randomSecret(),
    amountZatoshis: "100000000",
    address: TESTNET_SAPLING,
    network: "testnet",
    createdAt: NOW,
    expiresAt: "2026-03-15T10:00:00.000Z",
    publishedAt: null,
    revokedAt: null,
    lifecycle: "active",
    replacementFor: null,
    replacedBy: null,
    ...overrides,
  };
}

describe("creating a frozen organiser manifest", () => {
  it("freezes reviewed allocations that conserve the whole-bill amount", async () => {
    const manifest = await manifestFixture();
    expect(manifest.billId).toBe(BILL_ID);
    expect(manifest.requests).toEqual([]);
    expect(manifest.allocations.map((row) => row.zatoshis)).toEqual(["100000000", "100000000"]);
    expect(manifest.allocations.reduce((sum, row) => sum + BigInt(row.zatoshis), 0n)).toBe(200000000n);
    expect(manifest.signing.privateKey.d).toEqual(expect.any(String));
    expect(manifest.signing.publicKey.d).toBeUndefined();
    expect(() => validateBillManifest(manifest, BILL_ID)).not.toThrow();
  });

  it("recomputes allocations rather than trusting caller-supplied rows", async () => {
    const manifest = await manifestFixture();
    const tampered = snapshot(manifest);
    tampered.allocations[1].zatoshis = "1";
    expect(() => validateBillManifest(tampered)).toThrow(/allocations do not match/);
  });

  it("rejects mismatched titles, networks, bad amounts and unknown fields", async () => {
    const base = {
      billId: BILL_ID,
      title: "Dinner",
      receipt: receipt(),
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "200000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 14,
      now: NOW,
    };
    await expect(createBillManifest({ ...base, receipt: { ...receipt(), title: "Other" } })).rejects.toThrow(/titles must match/);
    await expect(createBillManifest({ ...base, receiving: { ...base.receiving, address: MAINNET_SAPLING } })).rejects.toThrow(/network/);
    await expect(createBillManifest({ ...base, receiving: { ...base.receiving, address: MAINNET_SAPLING, network: "mainnet" } })).rejects.toThrow(/testnet/);
    await expect(createBillManifest({ ...base, receiving: { ...base.receiving, type: "unified", receivers: [] } })).rejects.toThrow(/receiving address details/);
    await expect(createBillManifest({ ...base, receiving: { ...base.receiving, receivers: ["sapling", "sapling"] } })).rejects.toThrow(/receiving address details/);
    await expect(createBillManifest({ ...base, conversion: { ...base.conversion, wholeBillZatoshis: "0" } })).rejects.toThrow(/positive/);
    await expect(createBillManifest({ ...base, conversion: { ...base.conversion, wholeBillZatoshis: "2100000000000001" } })).rejects.toThrow(/limit/);
    await expect(createBillManifest({ ...base, expiryDays: 0 })).rejects.toThrow(/expiry/);
    await expect(createBillManifest({ ...base, expiryDays: 91 })).rejects.toThrow(/expiry/);
    await expect(createBillManifest({ ...base, conversion: { ...base.conversion, source: "coingecko" } })).rejects.toThrow(/market quote/);
    await expect(createBillManifest({ ...base, billId: "not-a-uuid" })).rejects.toThrow(/identifier/);
    await expect(createBillManifest({
      ...base,
      participants: [{ ...participants()[0] }, { ...participants()[1], isOrganiser: true }],
    })).rejects.toThrow(/Only one share/);
    await expect(createBillManifest({ ...base, mode: "custom", participants: [{ ...participants()[0], customMinor: "1" }, participants()[1]] }))
      .rejects.toThrow(/Custom shares/);
  });
});

describe("strict manifest validation", () => {
  it("rejects archive inconsistency, reversed timestamps and unexpected keys", async () => {
    const manifest = await manifestFixture();
    const archived = snapshot(manifest);
    archived.status = "archived";
    expect(() => validateBillManifest(archived)).toThrow(/archive state/);

    const reversed = snapshot(manifest);
    reversed.updatedAt = "2026-02-01T00:00:00.000Z";
    expect(() => validateBillManifest(reversed)).toThrow(/update time/);

    const extra = snapshot(manifest) as unknown as Record<string, unknown>;
    extra.unexpected = true;
    expect(() => validateBillManifest(extra)).toThrow(/manifest is invalid/);
  });

  it("rejects request entries that credit the organiser or duplicate capabilities", async () => {
    const manifest = await manifestFixture();
    const organised = snapshot(manifest);
    organised.requests.push(entry({ participantId: ORGANISER, participantLabel: "Me" }) as never);
    expect(() => validateBillManifest(organised)).toThrow(/unknown or organiser share/);

    const duplicated = snapshot(manifest);
    const first = entry();
    duplicated.requests.push(first as never, entry({
      readCapability: first.readCapability,
      participantId: ORGANISER,
      participantLabel: "Me",
    }) as never);
    expect(() => validateBillManifest(duplicated)).toThrow(/unknown or organiser share|duplicate/);

    const wrongAmount = snapshot(manifest);
    wrongAmount.requests.push(entry({ amountZatoshis: "999" }) as never);
    expect(() => validateBillManifest(wrongAmount)).toThrow(/amount does not match/);

    const sameCapabilities = snapshot(manifest);
    const twin = entry();
    sameCapabilities.requests.push(twin as never, entry({ reportCapability: twin.readCapability }) as never);
    expect(() => validateBillManifest(sameCapabilities)).toThrow(/duplicate/);
  });

  it("rejects an unpaired replacement link", async () => {
    const manifest = await manifestFixture();
    const linked = snapshot(manifest);
    linked.requests.push(entry({ replacementFor: randomId() }) as never);
    expect(() => validateBillManifest(linked)).toThrow(/replacement/);
  });

  it("only lists non-organiser shares with a positive amount as payable", async () => {
    const manifest: BillManifest = await manifestFixture();
    const payable = payableAllocations(manifest);
    expect(payable.map((row) => row.participantId)).toEqual([ALICE]);
    expect(assertPayableParticipant(manifest, ALICE).zatoshis).toBe("100000000");
    expect(() => assertPayableParticipant(manifest, ORGANISER)).toThrow(/no amount to reimburse/);

    const zero = snapshot(manifest);
    zero.allocations[1].zatoshis = "0";
    expect(payableAllocations(zero)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { DraftSession } from "@/lib/types";
import type { RateQuote } from "@/lib/rates";
import { allocateBill } from "@/lib/bills/split";
import { draftAmountMinor, draftBillDetails, draftConversionZatoshis, draftMemberKeys, ORGANISER_MEMBER_KEY } from "./draft-input";

const now = Date.parse("2026-10-27T08:00:00.000Z");

function draft(overrides: Partial<DraftSession> = {}): DraftSession {
  return {
    id: "test-draft",
    receipt: { title: "Reviewed receipt", currency: "USD", items: [{ name: "Expense", amount: "12.00" }], subtotal: "12.00", tax: "0.00", total: "12.00" },
    members: ["Participant A", "Participant B"],
    mode: "equal",
    amounts: [],
    expiresInMinutes: 10080,
    createdAt: now,
    ...overrides,
  };
}

function quote(overrides: Partial<RateQuote> = {}): RateQuote {
  return { source: "coingecko", currency: "USD", price: "24.00", fetchedAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), ...overrides };
}

describe("draft publication input", () => {
  it("never treats the first named participant as the organiser", () => {
    const value = draft();
    const before = structuredClone(value);
    const details = draftBillDetails(value);
    expect(details.participants.map((person) => person.isOrganiser)).toEqual([false, false]);
    expect(allocateBill(details.receipt, details.participants, "equal", "100000000").map((row) => row.shareMinor)).toEqual(["600", "600"]);
    expect(value).toEqual(before);
  });

  it("includes only an explicitly selected organiser share", () => {
    const value = draft({ includeOrganiser: true });
    const details = draftBillDetails(value);
    expect(draftMemberKeys(value)).toEqual([ORGANISER_MEMBER_KEY, ...value.members]);
    expect(details.participants.map((person) => person.isOrganiser)).toEqual([true, false, false]);
    expect(allocateBill(details.receipt, details.participants, "equal", "100000000").map((row) => row.shareMinor)).toEqual(["400", "400", "400"]);
  });

  it("preserves exact custom amounts and the separate organiser amount", () => {
    const details = draftBillDetails(draft({ includeOrganiser: true, mode: "custom", organiserCustomAmount: "3.000000", amounts: ["4.50", "4.500000"] }));
    expect(details.participants.map((person) => person.customMinor)).toEqual(["300", "450", "450"]);
    expect(allocateBill(details.receipt, details.participants, "custom", "100000000").map((row) => row.shareMinor)).toEqual(["300", "450", "450"]);
  });

  it("preserves item assignments instead of publishing empty assignees", () => {
    const details = draftBillDetails(draft({ mode: "itemised", assignments: { 0: ["Participant B"] } }));
    expect(details.receipt.items[0].assigneeIds).toEqual(["participant-2"]);
    expect(allocateBill(details.receipt, details.participants, "itemised", "100000000").map((row) => row.shareMinor)).toEqual(["0", "1200"]);
  });

  it("includes the organiser in explicitly selected item assignments", () => {
    const details = draftBillDetails(draft({ includeOrganiser: true, mode: "itemised", assignments: { 0: [ORGANISER_MEMBER_KEY] } }));
    expect(details.receipt.items[0].assigneeIds).toEqual(["organiser"]);
  });

  it("rejects stale assignments instead of reallocating them silently", () => {
    expect(() => draftBillDetails(draft({ mode: "itemised", assignments: { 0: ["Removed participant"] } }))).toThrow("Review the participants assigned");
  });

  it("does not fabricate a receipt title", () => {
    const value = draft();
    delete value.receipt.title;
    const details = draftBillDetails(value);
    expect(details.receipt.title).toBe("");
    expect(() => allocateBill(details.receipt, details.participants, "equal", "100000000")).toThrow("title");
  });

  it("discards only redundant decimal zeros and never rounds user amounts", () => {
    expect(draftAmountMinor("0.290000", 2)).toBe(29n);
    expect(draftAmountMinor("1200.000000", 0)).toBe(1200n);
    expect(() => draftAmountMinor("0.291", 2)).toThrow("at most 2 decimal places");
    expect(() => draftAmountMinor("1e3", 2)).toThrow();
  });
});

describe("explicit draft conversions", () => {
  it("requires a real quote instead of falling back to a fabricated price", () => {
    expect(() => draftConversionZatoshis(draft(), "coingecko", null, "", now)).toThrow("live rate is unavailable");
  });

  it("converts using the supplied live quote without mutating it", () => {
    const liveQuote = quote();
    const before = structuredClone(liveQuote);
    expect(draftConversionZatoshis(draft(), "coingecko", liveQuote, "", now)).toBe("50000000");
    expect(liveQuote).toEqual(before);
  });

  it("rejects stale and wrong-currency quotes", () => {
    expect(() => draftConversionZatoshis(draft(), "coingecko", quote({ updatedAt: new Date(now - 301_000).toISOString() }), "", now)).toThrow("stale");
    expect(() => draftConversionZatoshis(draft(), "coingecko", quote({ currency: "EUR" }), "", now)).toThrow("invalid");
  });

  it("requires an explicit positive manual ZEC amount and no market quote", () => {
    expect(draftConversionZatoshis(draft(), "manual", null, "0.12345678", now)).toBe("12345678");
    expect(() => draftConversionZatoshis(draft(), "manual", null, "", now)).toThrow("agreed manually");
    expect(() => draftConversionZatoshis(draft(), "manual", null, "0", now)).toThrow("positive");
    expect(() => draftConversionZatoshis(draft(), "manual", quote(), "1", now)).toThrow("cannot use a market quote");
    expect(() => draftConversionZatoshis(draft(), "manual", null, "0.123456789", now)).toThrow("8 decimal places");
  });
});

import { describe, expect, it } from "vitest";
import { suggestZatoshis, validateQuote, type RateQuote } from ".";

const now = Date.parse("2026-10-24T00:00:00Z");
const quote: RateQuote = { source: "coingecko", currency: "USD", price: "37.51", updatedAt: new Date(now).toISOString(), fetchedAt: new Date(now).toISOString() };
describe("reviewable public quotes", () => {
  it("rounds exactly once to a zatoshi", () => expect(suggestZatoshis("100", 2, quote, now)).toBe("2665956"));
  it("rejects stale, future, wrong-currency and invalid prices", () => {
    expect(() => validateQuote(quote, "USD", now + 300001)).toThrow(/stale/);
    expect(() => validateQuote(quote, "EUR", now)).toThrow(/invalid/);
    expect(() => validateQuote({ ...quote, updatedAt: new Date(now + 61000).toISOString() }, "USD", now)).toThrow(/stale/);
    expect(() => validateQuote({ ...quote, price: "0" }, "USD", now)).toThrow(/invalid/);
  });
});

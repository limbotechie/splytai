import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseReceiptText } from "./parser";
import { installCrypto } from "../private-workspace/test-support";

beforeEach(() => installCrypto());
afterEach(() => vi.unstubAllGlobals());

describe("local OCR receipt parser", () => {
  it("parses standard restaurant receipt with line items and totals", () => {
    const rawText = `
Blue Bottle Cafe
123 Market St
San Francisco, CA

1 Latte 5.50
1 Croissant 4.00
1 Avocado Toast 12.00

Subtotal 21.50
Tax 1.83
Tip 4.00
Total 27.33
`;

    const candidate = parseReceiptText(rawText, 92);

    expect(candidate.title).toBe("Blue Bottle Cafe");
    expect(candidate.currency).toBe("USD");
    expect(candidate.scale).toBe(2);
    expect(candidate.items).toHaveLength(3);
    expect(candidate.items[0].label).toBe("Latte");
    expect(candidate.items[0].amountMinor).toBe("550");
    expect(candidate.items[1].label).toBe("Croissant");
    expect(candidate.items[1].amountMinor).toBe("400");
    expect(candidate.items[2].label).toBe("Avocado Toast");
    expect(candidate.items[2].amountMinor).toBe("1200");

    expect(candidate.subtotalMinor).toBe("2150");
    expect(candidate.taxMinor).toBe("183");
    expect(candidate.tipMinor).toBe("400");
    expect(candidate.totalMinor).toBe("2733");
    expect(candidate.reviewed).toBe(false);
    expect(candidate.confidence).toBe(92);
  });

  it("handles European receipt with comma decimals and Euro currency", () => {
    const rawText = `
Boulangerie Paris
Pain au Chocolat 2,50 €
Baguette Tradition 1,30 €
Cafe Creme 3,20 €
Sous-Total 7,00 €
TVA 0,70 €
Total 7,70 €
`;

    const candidate = parseReceiptText(rawText);

    expect(candidate.currency).toBe("EUR");
    expect(candidate.items).toHaveLength(3);
    expect(candidate.items[0].label).toBe("Pain au Chocolat");
    expect(candidate.items[0].amountMinor).toBe("250");
    expect(candidate.subtotalMinor).toBe("700");
    expect(candidate.taxMinor).toBe("70");
    expect(candidate.totalMinor).toBe("770");
  });

  it("handles discounts and missing subtotal/total with fallback derivation", () => {
    const rawText = `
Pizza Shack
Large Pepperoni 18.00
Garlic Knots 6.00
Promo Discount 3.00
`;

    const candidate = parseReceiptText(rawText);

    expect(candidate.items).toHaveLength(2);
    expect(candidate.items[0].label).toBe("Large Pepperoni");
    expect(candidate.items[0].amountMinor).toBe("1800");
    expect(candidate.items[1].label).toBe("Garlic Knots");
    expect(candidate.items[1].amountMinor).toBe("600");

    expect(candidate.discountMinor).toBe("300");
    // Computed subtotal = 1800 + 600 = 2400
    expect(candidate.subtotalMinor).toBe("2400");
    // Computed total = 2400 - 300 = 2100
    expect(candidate.totalMinor).toBe("2100");
  });

  it("detects ZEC currency if present in text", () => {
    const rawText = `
Zcash Meetup Dinner
Pizza 0.50000000 ZEC
Drinks 0.20000000 ZEC
Total 0.70000000 ZEC
`;

    const candidate = parseReceiptText(rawText);
    expect(candidate.currency).toBe("ZEC");
    expect(candidate.scale).toBe(8);
    expect(candidate.items[0].amountMinor).toBe("50000000");
    expect(candidate.items[1].amountMinor).toBe("20000000");
    expect(candidate.totalMinor).toBe("70000000");
  });

  it("does not confuse a spaced subtotal with the final total", () => {
    const candidate = parseReceiptText("Cafe\nCoffee $2.50\nSub Total $2.50\nTax $0.25");
    expect(candidate.subtotalMinor).toBe("250");
    expect(candidate.totalMinor).toBe("275");
  });

  it("does not truncate excessive precision or parse the tail of a number", () => {
    const candidate = parseReceiptText("Cafe\nCoffee 2.50\nUnclear 1.234 USD\nUnclear 1234567.89");
    expect(candidate.items.map((item) => item.amountMinor)).toEqual(["250"]);
    expect(candidate.totalMinor).toBe("250");
  });
});

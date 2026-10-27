import { describe, it, expect } from "vitest";
import { computeItemisedSplit } from "./split";
import type { Address, ParsedReceipt } from "./types";

const addr = (n: number): Address => `0x${n.toString().padStart(40, "0")}` as Address;

export const A = addr(1);
export const B = addr(2);
export const C = addr(3);

export function makeReceipt(
  items: { name: string; amount: string }[],
  tax = "0.000000",
  total?: string
): ParsedReceipt {
  const subtotalMicros = items.reduce((sum, item) => {
    const [whole, frac = ""] = item.amount.split(".");
    return sum + BigInt(whole) * 1_000_000n + BigInt(`${frac}000000`.slice(0, 6));
  }, 0n);
  const subtotal = `${subtotalMicros / 1_000_000n}.${(subtotalMicros % 1_000_000n).toString().padStart(6, "0")}`;
  return { items, subtotal, tax, total: total ?? subtotal, currency: "USDm" };
}

describe("computeItemisedSplit", () => {
  it("treats assigning all members explicitly the same as an empty assignment", () => {
    const receipt = makeReceipt([{ name: "Dish", amount: "15.000000" }]);
    const withEmpty = computeItemisedSplit(receipt, [A, B, C], {});
    const withAll = computeItemisedSplit(receipt, [A, B, C], { 0: [A, B, C] });
    expect(withEmpty.get(A)).toBe(withAll.get(A));
    expect(withEmpty.get(B)).toBe(withAll.get(B));
    expect(withEmpty.get(C)).toBe(withAll.get(C));
  });

  it("does not lose a micro when item cost is indivisible by member count", () => {
    const receipt = makeReceipt([{ name: "Tiny", amount: "0.000001" }]);
    const result = computeItemisedSplit(receipt, [A, B], {});
    const sum = (result.get(A) ?? 0n) + (result.get(B) ?? 0n);
    expect(sum).toBe(1n);
  });

  it("sum of per-member amounts always equals the receipt total", () => {
    const receipt = makeReceipt(
      [
        { name: "A", amount: "10.000001" },
        { name: "B", amount: "7.000003" },
      ],
      "0.000000",
      "17.000004"
    );
    const result = computeItemisedSplit(receipt, [A, B, C], {});
    let sum = 0n;
    for (const v of result.values()) sum += v;
    expect(sum).toBe(17_000_004n);
  });

  it("distributes tax gap equally among all members regardless of item assignments", () => {
    const receipt = makeReceipt(
      [{ name: "Meal", amount: "30.000000" }],
      "3.000000",
      "33.000000"
    );
    const result = computeItemisedSplit(receipt, [A, B], { 0: [A] });
    expect(result.get(A)).toBe(31_500_000n); // 30 + 1.5 tax
    expect(result.get(B)).toBe(1_500_000n);  // 0 + 1.5 tax
  });

  it("handles multiple items each assigned to different member subsets", () => {
    const receipt = makeReceipt([
      { name: "Pizza", amount: "24.000000" },
      { name: "Salad", amount: "12.000000" },
    ]);
    const result = computeItemisedSplit(receipt, [A, B, C], { 0: [A, B], 1: [C] });
    expect(result.get(A)).toBe(12_000_000n);
    expect(result.get(B)).toBe(12_000_000n);
    expect(result.get(C)).toBe(12_000_000n);
  });

  it("splits a shared item equally among an assigned subset of members", () => {
    const receipt = makeReceipt([{ name: "Wine", amount: "20.000000" }]);
    const result = computeItemisedSplit(receipt, [A, B, C], { 0: [A, B] });
    expect(result.get(A)).toBe(10_000_000n);
    expect(result.get(B)).toBe(10_000_000n);
    expect(result.get(C)).toBe(0n);
  });

  it("assigns full item cost to a single member when only that member is listed", () => {
    const receipt = makeReceipt([{ name: "Steak", amount: "40.000000" }]);
    const result = computeItemisedSplit(receipt, [A, B], { 0: [A] });
    expect(result.get(A)).toBe(40_000_000n);
    expect(result.get(B)).toBe(0n);
  });

  it("splits a single item equally when no assignments are given", () => {
    const receipt = makeReceipt([{ name: "Burger", amount: "30.000000" }]);
    const result = computeItemisedSplit(receipt, [A, B, C], {});
    expect(result.get(A)).toBe(10_000_000n);
    expect(result.get(B)).toBe(10_000_000n);
    expect(result.get(C)).toBe(10_000_000n);
  });
});

import { describe, expect, it } from "vitest";
import { allocateBill } from "./split";
import { distribute, formatZec, parseDecimal } from "./money";
import type { Participant, Receipt } from "./types";

const people: Participant[] = [
  { id: "a", label: "Me", isOrganiser: true, customMinor: "100" },
  { id: "b", label: "Person B", isOrganiser: false, customMinor: "100" },
  { id: "c", label: "Person C", isOrganiser: false, customMinor: "101" },
];
const receipt: Receipt = { title: "Example", currency: "USD", scale: 2, reviewed: true, items: [], totalMinor: "301", taxMinor: "0", tipMinor: "0", discountMinor: "0" };

describe("exact receipt and ZEC allocations", () => {
  it("includes the organiser in the complete allocation without creating an extra debt", () => {
    const rows = allocateBill(receipt, people, "equal", "100000000");
    expect(rows.map((row) => row.shareMinor)).toEqual(["101", "100", "100"]);
    expect(rows.reduce((sum, row) => sum + BigInt(row.zatoshis), 0n)).toBe(100000000n);
    expect(rows.filter((row) => !row.isOrganiser).reduce((sum, row) => sum + BigInt(row.zatoshis), 0n)).toBeLessThan(100000000n);
  });
  it("uses stable IDs, not the display order, to break remainder ties", () => {
    expect(Object.fromEntries(distribute(2n, [{ id: "b", weight: 1n }, { id: "a", weight: 1n }, { id: "c", weight: 1n }]))).toEqual({ a: 1n, b: 1n, c: 0n });
  });
  it("allocates shared items and each adjustment proportionally", () => {
    const itemised = { ...receipt, totalMinor: "352", taxMinor: "30", tipMinor: "31", discountMinor: "10", items: [{ id: "item", label: "Shared", amountMinor: "301", assigneeIds: ["a", "b", "c"] }] };
    const rows = allocateBill(itemised, people, "itemised", "53");
    expect(rows.map((row) => row.shareMinor)).toEqual(["118", "117", "117"]);
    for (const field of ["shareMinor", "zatoshis", "taxMinor", "tipMinor", "discountMinor"] as const) {
      expect(rows.reduce((sum, row) => sum + BigInt(row[field]), 0n)).toBe(BigInt({ shareMinor: 352, zatoshis: 53, taxMinor: 30, tipMinor: 31, discountMinor: 10 }[field]));
    }
  });
  it("requires complete custom allocations and explicit item assignment", () => {
    expect(allocateBill(receipt, people, "custom", "23").length).toBe(3);
    expect(() => allocateBill(receipt, people.slice(1), "custom", "23")).toThrow(/Custom shares/);
    expect(() => allocateBill({ ...receipt, items: [{ id: "i", label: "Unassigned", amountMinor: "301", assigneeIds: [] }] }, people, "itemised", "23")).toThrow(/Assign every/);
  });
  it("rejects unexplained differences, negative inputs, empty groups and limits", () => {
    expect(() => allocateBill({ ...receipt, items: [{ id: "i", label: "Item", amountMinor: "300", assigneeIds: ["a"] }] }, people, "equal", "1")).toThrow(/must equal/);
    expect(() => allocateBill(receipt, [], "equal", "1")).toThrow(/between 1 and 50/);
    expect(() => allocateBill(receipt, Array.from({ length: 51 }, (_, i) => ({ ...people[0], id: `${i}` })), "equal", "1")).toThrow(/50/);
    expect(() => allocateBill({ ...receipt, totalMinor: "1000000000000001" }, people, "equal", "1")).toThrow(/limit/);
    expect(() => allocateBill(receipt, people, "equal", "2100000000000001")).toThrow(/limit/);
    expect(() => allocateBill(receipt, [{ ...people[0], customMinor: "-1" }, people[1], people[2]], "custom", "1")).toThrow(/non-negative/);
  });
  it("conserves money across bounded generated groups and totals", () => {
    for (let count = 1; count <= 50; count++) {
      const members = Array.from({ length: count }, (_, i) => ({ ...people[1], id: String(i).padStart(2, "0") }));
      for (const total of ["0", "1", "17", "1031", "99999999999999"]) {
        const zec = total === "0" ? "0" : "999999997";
        const rows = allocateBill({ ...receipt, totalMinor: total }, members, "equal", zec);
        expect(rows.reduce((sum, row) => sum + BigInt(row.shareMinor), 0n)).toBe(BigInt(total));
        expect(rows.reduce((sum, row) => sum + BigInt(row.zatoshis), 0n)).toBe(BigInt(zec));
      }
    }
  });
  it("never uses floating point to parse or format monetary values", () => {
    expect(parseDecimal("0.00000001", 8)).toBe(1n);
    expect(formatZec(123456789n)).toBe("1.23456789");
    for (const bad of ["-1", "1e2", "1,000", ".5", "1.", "NaN"]) expect(() => parseDecimal(bad, 2)).toThrow();
    expect(() => parseDecimal("0.001", 2)).toThrow(/decimal places/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processReceiptImage, confirmReceiptReview, createManualReceipt } from "./pipeline";
import type { OcrProgress } from "./types";
import { installCrypto } from "../private-workspace/test-support";

beforeEach(() => installCrypto());
afterEach(() => vi.unstubAllGlobals());

describe("local OCR pipeline and human review gate", () => {
  const sampleOcrText = `
The Burger Joint
Cheeseburger 10.00
Fries 4.00
Tax 1.12
Total 15.12
`;

  const mockRunner = async (
    _image: Blob | File | string,
    onProgress?: (p: OcrProgress) => void,
  ) => {
    onProgress?.({ status: "recognizing text", progress: 0.5 });
    onProgress?.({ status: "done", progress: 1.0 });
    return { text: sampleOcrText, confidence: 95 };
  };

  const mockDecoder = async () => ({ width: 1000, height: 1200 });

  it("processes receipt image locally and returns candidate requiring review", async () => {
    const progressList: OcrProgress[] = [];
    const blob = new Blob(["image-bytes"], { type: "image/png" });

    const candidate = await processReceiptImage(blob, {
      runner: mockRunner,
      dimensionReader: mockDecoder,
      onProgress: (p) => progressList.push(p),
    });

    expect(progressList.length).toBeGreaterThan(0);
    expect(candidate.title).toBe("The Burger Joint");
    expect(candidate.items).toHaveLength(2);
    expect(candidate.totalMinor).toBe("1512");
    expect(candidate.reviewed).toBe(false);
  });

  it("confirms human review and seals into confirmed Receipt", () => {
    const candidate = {
      title: "The Burger Joint",
      currency: "USD",
      scale: 2,
      items: [
        { id: "1", label: "Cheeseburger", amountMinor: "1000", assigneeIds: [] },
        { id: "2", label: "Fries", amountMinor: "400", assigneeIds: [] },
      ],
      subtotalMinor: "1400",
      taxMinor: "112",
      tipMinor: "0",
      discountMinor: "0",
      totalMinor: "1512",
      rawText: sampleOcrText,
      confidence: 95,
      reviewed: false as const,
    };

    // Confirm with an added tip
    const confirmed = confirmReceiptReview(candidate, {
      tipMinor: "200",
      totalMinor: "1712", // 1400 + 112 + 200 = 1712
    });

    expect(confirmed.reviewed).toBe(true);
    expect(confirmed.tipMinor).toBe("200");
    expect(confirmed.totalMinor).toBe("1712");
    expect(confirmed.items).toHaveLength(2);
  });

  it("rejects confirmation if arithmetic does not match", () => {
    const candidate = {
      title: "Cafe",
      currency: "USD",
      scale: 2,
      items: [{ id: "1", label: "Coffee", amountMinor: "500", assigneeIds: [] }],
      subtotalMinor: "500",
      taxMinor: "50",
      tipMinor: "0",
      discountMinor: "0",
      totalMinor: "550",
      rawText: "",
      confidence: 90,
      reviewed: false as const,
    };

    // Total claims 600 instead of 550
    expect(() =>
      confirmReceiptReview(candidate, {
        totalMinor: "600",
      }),
    ).toThrow(/Receipt arithmetic mismatch/);
  });

  it("creates a manual receipt directly without image scanning", () => {
    const receipt = createManualReceipt({
      title: "Taco Tuesday",
      currency: "USD",
      items: [
        { label: "Fish Taco", amountMinor: "450" },
        { label: "Horchata", amountMinor: "300" },
      ],
      taxMinor: "60",
      tipMinor: "150",
      // Expected total: 450 + 300 + 60 + 150 = 960
    });

    expect(receipt.reviewed).toBe(true);
    expect(receipt.title).toBe("Taco Tuesday");
    expect(receipt.totalMinor).toBe("960");
    expect(receipt.items).toHaveLength(2);
    expect(receipt.items[0].label).toBe("Fish Taco");
  });

  it("rejects manual receipt with empty items or invalid totals", () => {
    expect(() =>
      createManualReceipt({
        title: "Empty",
        items: [],
      }),
    ).toThrow(/at least one item/);

    expect(() =>
      createManualReceipt({
        title: "Bad total",
        items: [{ label: "Item", amountMinor: "100" }],
        totalMinor: "500", // Mismatch with 100
      }),
    ).toThrow(/Receipt arithmetic mismatch/);
  });
});

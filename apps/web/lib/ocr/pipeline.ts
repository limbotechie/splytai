/**
 * Receipt OCR Pipeline and Human Review Gate.
 *
 * Coordinates:
 *   1. Bounded image validation
 *   2. Local worker recognition
 *   3. Text parsing into a candidate receipt
 *   4. Mandatory human review before creating a confirmed Receipt
 *   5. Manual receipt entry fallback
 */

import { randomId } from "../private-workspace/crypto";
import type { Receipt, ReceiptItem } from "../bills/types";
import { assertValidReceiptImage, type ImageDimensionReader } from "./image";
import { parseReceiptText } from "./parser";
import { defaultRecognizeReceipt, type WorkerRunner } from "./worker";
import type {
  ManualReceiptInput,
  OcrProgress,
  ParsedReceiptCandidate,
  ReceiptReviewEdits,
} from "./types";

export interface ProcessReceiptOptions {
  onProgress?: (progress: OcrProgress) => void;
  dimensionReader?: ImageDimensionReader;
  runner?: WorkerRunner;
}

/**
 * Executes the complete OCR pipeline on a receipt image.
 * Yields an unconfirmed candidate receipt with `reviewed: false`.
 * Never uploads the image.
 */
export async function processReceiptImage(
  file: Blob | File,
  options: ProcessReceiptOptions = {},
): Promise<ParsedReceiptCandidate> {
  // 1. Validate image bounds (size, mime, decoded dimensions)
  await assertValidReceiptImage(file, options.dimensionReader);

  // 2. Local recognition via WebAssembly worker
  const runner = options.runner ?? defaultRecognizeReceipt;
  const ocrResult = await runner(file, options.onProgress);

  // 3. Parse recognized text into structured candidate
  return parseReceiptText(ocrResult.text, ocrResult.confidence);
}

/**
 * Validates and locks human review edits into a confirmed `Receipt`.
 * Enforces arithmetic integrity:
 *   sum(items) + tax + tip - discount == total
 */
export function confirmReceiptReview(
  candidate: ParsedReceiptCandidate,
  edits: ReceiptReviewEdits = {},
): Receipt {
  const title = (edits.title ?? candidate.title).trim();
  if (!title) {
    throw new Error("Please provide a title for this receipt.");
  }

  const currency = edits.currency ?? candidate.currency;
  const scale = edits.scale ?? candidate.scale;

  const rawItems = edits.items ?? candidate.items;
  if (!Array.isArray(rawItems)) {
    throw new Error("Receipt items must be an array.");
  }

  const items: ReceiptItem[] = rawItems.map((item, index) => {
    const label = item.label.trim();
    if (!label) {
      throw new Error(`Receipt item #${index + 1} requires a label.`);
    }
    const amount = BigInt(item.amountMinor);
    if (amount <= 0n) {
      throw new Error(`Receipt item "${label}" must have a positive amount.`);
    }
    return {
      id: item.id || randomId(),
      label,
      amountMinor: amount.toString(),
      assigneeIds: item.assigneeIds || [],
    };
  });

  const taxMinor = BigInt(edits.taxMinor ?? candidate.taxMinor);
  const tipMinor = BigInt(edits.tipMinor ?? candidate.tipMinor);
  const discountMinor = BigInt(edits.discountMinor ?? candidate.discountMinor);
  const totalMinor = BigInt(edits.totalMinor ?? candidate.totalMinor);

  if (taxMinor < 0n || tipMinor < 0n || discountMinor < 0n || totalMinor <= 0n) {
    throw new Error("Receipt totals must not be negative.");
  }

  // Arithmetic validation
  const itemsSum = items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  if (items.length > 0) {
    const expectedTotal = itemsSum + taxMinor + tipMinor - discountMinor;
    if (expectedTotal !== totalMinor) {
      throw new Error(
        `Receipt arithmetic mismatch: sum of items (${itemsSum}) + tax (${taxMinor}) + tip (${tipMinor}) - discount (${discountMinor}) = ${expectedTotal}, but total was set to ${totalMinor}.`,
      );
    }
  }

  return {
    title,
    currency,
    scale,
    items,
    taxMinor: taxMinor.toString(),
    tipMinor: tipMinor.toString(),
    discountMinor: discountMinor.toString(),
    totalMinor: totalMinor.toString(),
    reviewed: true,
  };
}

/**
 * Creates a structured, reviewed receipt directly from manual input
 * for unsupported devices or manual entry without image scanning.
 */
export function createManualReceipt(input: ManualReceiptInput): Receipt {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Please provide a title for this receipt.");
  }

  const currency = input.currency || "USD";
  const scale = input.scale ?? 2;

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("Please add at least one item to the receipt.");
  }

  const items: ReceiptItem[] = input.items.map((item, index) => {
    const label = item.label.trim();
    if (!label) {
      throw new Error(`Receipt item #${index + 1} requires a label.`);
    }
    const amount = BigInt(item.amountMinor);
    if (amount <= 0n) {
      throw new Error(`Receipt item "${label}" must have a positive amount.`);
    }
    return {
      id: item.id || randomId(),
      label,
      amountMinor: amount.toString(),
      assigneeIds: item.assigneeIds || [],
    };
  });

  const taxMinor = BigInt(input.taxMinor || "0");
  const tipMinor = BigInt(input.tipMinor || "0");
  const discountMinor = BigInt(input.discountMinor || "0");

  const itemsSum = items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);
  const expectedTotal = itemsSum + taxMinor + tipMinor - discountMinor;

  const totalMinor = input.totalMinor ? BigInt(input.totalMinor) : expectedTotal;

  if (totalMinor !== expectedTotal) {
    throw new Error(
      `Receipt arithmetic mismatch: items (${itemsSum}) + tax (${taxMinor}) + tip (${tipMinor}) - discount (${discountMinor}) = ${expectedTotal}, but total was set to ${totalMinor}.`,
    );
  }

  return {
    title,
    currency,
    scale,
    items,
    taxMinor: taxMinor.toString(),
    tipMinor: tipMinor.toString(),
    discountMinor: discountMinor.toString(),
    totalMinor: totalMinor.toString(),
    reviewed: true,
  };
}

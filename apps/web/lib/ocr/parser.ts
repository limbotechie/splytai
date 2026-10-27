/**
 * Client-side receipt text parser.
 *
 * Extracts line items, amounts, subtotal, tax, tip, discount, and total from
 * raw OCR text. Produces a candidate receipt that requires human review.
 */

import { randomId } from "../private-workspace/crypto";
import type { ParsedItemCandidate, ParsedReceiptCandidate } from "./types";

// Summary line keywords
const SUBTOTAL_KEYWORDS = /\b(?:sub[\s-]*total|subtotal|net\s*amount|sous[\s-]*total)\b/i;
const TAX_KEYWORDS = /\b(?:tax|vat|tva|gst|sales\s*tax|hst)\b/i;
const TIP_KEYWORDS = /\b(?:tip|gratuity|service\s*charge|service)\b/i;
const DISCOUNT_KEYWORDS = /\b(?:discount|coupon|promo|savings|voucher|discounted)\b/i;
const TOTAL_KEYWORDS = /\b(?:total|grand\s*total|balance\s*due|amount\s*due|final\s*total)\b/i;

function normalizeAmount(amountStr: string, scale = 2): bigint {
  const [whole, fraction = ""] = amountStr.replace(/,/g, ".").split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}

function detectCurrency(text: string): { currency: string; scale: number } {
  if (text.includes("€") || /\bEUR\b/i.test(text)) {
    return { currency: "EUR", scale: 2 };
  }
  if (text.includes("£") || /\bGBP\b/i.test(text)) {
    return { currency: "GBP", scale: 2 };
  }
  if (/\bZEC\b/i.test(text)) {
    return { currency: "ZEC", scale: 8 };
  }
  // Default to USD
  return { currency: "USD", scale: 2 };
}

function cleanLabel(rawLabel: string): string {
  // Remove leading quantities like "1x ", "2 ", "3* "
  return rawLabel
    .replace(/^\s*\d+\s*[xX*]\s*/, "")
    .replace(/^\s*\d+\s+/, "")
    .replace(/[$€£¥]/g, "")
    .trim();
}

/**
 * Parses raw OCR recognition text into a structured receipt candidate.
 */
export function parseReceiptText(rawText: string, confidence = 80): ParsedReceiptCandidate {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const { currency, scale } = detectCurrency(rawText);
  // Bound the whole token so excess precision cannot be mistaken for a smaller price.
  const priceRegex = new RegExp(
    String.raw`(?:^|\s)(?:[$€£¥]\s*)?(\d{1,6}(?:[.,]\d{1,${scale}})?)\s*(?:[$€£¥]|USD|EUR|GBP|ZEC)?\s*$`,
    "i",
  );

  let title = "Receipt";
  let titleFound = false;

  let subtotalMinor: bigint | null = null;
  let taxMinor: bigint = 0n;
  let tipMinor: bigint = 0n;
  let discountMinor: bigint = 0n;
  let totalMinor: bigint | null = null;

  const items: ParsedItemCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Pick top line as potential merchant title if not a price or date line
    if (!titleFound && i < 4) {
      if (
        line.length >= 3 &&
        !priceRegex.test(line) &&
        !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(line) &&
        !/\b(?:tel|phone|cashier|server|order|table|receipt|invoice)\b/i.test(line)
      ) {
        title = line;
        titleFound = true;
        continue;
      }
    }

    const priceMatch = line.match(priceRegex);
    if (!priceMatch) {
      continue;
    }

    const amountStr = priceMatch[1];
    const amountMinor = normalizeAmount(amountStr, scale);
    const labelPart = line.slice(0, priceMatch.index).trim();

    // Check if this line is a summary row
    if (SUBTOTAL_KEYWORDS.test(labelPart)) {
      subtotalMinor = amountMinor;
      continue;
    }

    if (TOTAL_KEYWORDS.test(labelPart)) {
      totalMinor = amountMinor;
      continue;
    }

    if (TAX_KEYWORDS.test(labelPart)) {
      taxMinor = amountMinor;
      continue;
    }

    if (TIP_KEYWORDS.test(labelPart)) {
      tipMinor = amountMinor;
      continue;
    }

    if (DISCOUNT_KEYWORDS.test(labelPart)) {
      discountMinor = amountMinor;
      continue;
    }

    // Otherwise, treat as an item line if label is meaningful
    const cleaned = cleanLabel(labelPart);
    if (cleaned.length >= 1 && amountMinor > 0n) {
      items.push({
        id: randomId(),
        label: cleaned,
        amountMinor: amountMinor.toString(),
        assigneeIds: [],
      });
    }
  }

  // Fallback reconciliations
  const computedItemsSum = items.reduce((sum, item) => sum + BigInt(item.amountMinor), 0n);

  if (subtotalMinor === null) {
    subtotalMinor = computedItemsSum;
  }

  if (totalMinor === null) {
    totalMinor = subtotalMinor + taxMinor + tipMinor - discountMinor;
    if (totalMinor < 0n) totalMinor = 0n;
  }

  return {
    title,
    currency,
    scale,
    items,
    subtotalMinor: subtotalMinor.toString(),
    taxMinor: taxMinor.toString(),
    tipMinor: tipMinor.toString(),
    discountMinor: discountMinor.toString(),
    totalMinor: totalMinor.toString(),
    rawText,
    confidence,
    reviewed: false,
  };
}

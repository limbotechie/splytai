import Decimal from "decimal.js";
import { integer, MAX_ZATOSHIS } from "../bills/money";

export interface RateQuote {
  source: "coingecko";
  currency: string;
  price: string;
  updatedAt: string;
  fetchedAt: string;
}

export const RATE_CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "NGN", "INR", "BRL", "ZAR", "KES"] as const;

export function validateQuote(quote: RateQuote, currency: string, now = Date.now()): void {
  if (quote.source !== "coingecko" || quote.currency.toUpperCase() !== currency || !/^\d+(?:\.\d{1,18})?$/.test(quote.price) || quote.price.length > 40 || new Decimal(quote.price).lte(0)) {
    throw new Error("The market quote is invalid. Enter the ZEC total manually instead.");
  }
  const updated = Date.parse(quote.updatedAt);
  if (!Number.isFinite(updated) || now - updated > 5 * 60_000 || updated > now + 60_000) {
    throw new Error("This market quote is stale. Refresh it or explicitly enter a manual ZEC total.");
  }
}

export function suggestZatoshis(totalMinor: string, scale: number, quote: RateQuote, now = Date.now()): string {
  validateQuote(quote, quote.currency.toUpperCase(), now);
  integer(totalMinor);
  if (!Number.isInteger(scale) || scale < 0 || scale > 3) throw new Error("Unsupported currency precision.");
  const ExactDecimal = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
  const rounded = new ExactDecimal(totalMinor).div(new ExactDecimal(10).pow(scale)).div(quote.price).mul("100000000").toDecimalPlaces(0).toFixed(0);
  return integer(rounded, MAX_ZATOSHIS).toString();
}

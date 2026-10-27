export const MAX_MINOR = 100_000_000_000_000n;
export const MAX_ZATOSHIS = 21_000_000n * 100_000_000n;

export function integer(value: string, max = MAX_MINOR): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,15})$/.test(value)) {
    throw new Error("Enter a non-negative whole number of minor units.");
  }
  const result = BigInt(value);
  if (result > max) throw new Error("This amount exceeds the supported limit.");
  return result;
}

export function parseDecimal(value: string, scale: number, max = MAX_MINOR): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) throw new Error("Unsupported currency precision.");
  if (typeof value !== "string" || value.length > 32 || !/^\d+(?:\.\d+)?$/.test(value)) {
    throw new Error("Enter an amount using digits and a decimal point, without commas or signs.");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new Error(`This amount supports at most ${scale} decimal places.`);
  const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  if (result > max) throw new Error("This amount exceeds the supported limit.");
  return result;
}

export function formatDecimal(value: string | bigint, scale: number): string {
  const amount = typeof value === "bigint" ? value : integer(value, MAX_ZATOSHIS);
  if (amount < 0n || !Number.isInteger(scale) || scale < 0 || scale > 8) throw new Error("Invalid amount.");
  const digits = amount.toString().padStart(scale + 1, "0");
  return scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits;
}

export const formatZec = (value: string | bigint) => formatDecimal(value, 8);

export function currencyScale(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf("currency").includes(currency)) {
    throw new Error("Enter a supported three-letter ISO currency code.");
  }
  const scale = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits;
  if (scale === undefined || scale > 3) throw new Error("This currency's precision is not supported.");
  return scale;
}

export function distribute(total: bigint, weights: readonly { id: string; weight: bigint }[]): Map<string, bigint> {
  if (total < 0n || !weights.length || new Set(weights.map((entry) => entry.id)).size !== weights.length || weights.some((entry) => entry.weight < 0n)) {
    throw new Error("Invalid allocation inputs.");
  }
  const denominator = weights.reduce((sum, entry) => sum + entry.weight, 0n);
  if (denominator === 0n) {
    if (total !== 0n) throw new Error("A positive amount needs a positive allocation basis.");
    return new Map(weights.map((entry) => [entry.id, 0n]));
  }
  const rows = weights.map(({ id, weight }) => ({ id, amount: total * weight / denominator, remainder: total * weight % denominator }));
  let remaining = total - rows.reduce((sum, row) => sum + row.amount, 0n);
  rows.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const row of rows) {
    if (remaining === 0n) break;
    row.amount += 1n;
    remaining -= 1n;
  }
  return new Map(rows.map(({ id, amount }) => [id, amount]));
}

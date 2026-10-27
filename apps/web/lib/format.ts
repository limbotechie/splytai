import type { Address, Micros } from "./types";

const MICRO_MULTIPLIER = 1_000_000n;

export function microsFromDecimalString(value: string): Micros {
  const [whole, frac = ""] = value.split(".");
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole) * MICRO_MULTIPLIER + BigInt(padded);
}

export function microsToDecimalString(value: Micros): string {
  const whole = value / MICRO_MULTIPLIER;
  const frac = (value % MICRO_MULTIPLIER).toString().padStart(6, "0");
  return `${whole.toString()}.${frac}`;
}

export function formatUSDm(micros: Micros | string, opts: { compact?: boolean } = {}): string {
  const value = typeof micros === "string" ? BigInt(micros) : micros;
  const whole = value / MICRO_MULTIPLIER;
  const frac = (value % MICRO_MULTIPLIER).toString().padStart(6, "0");
  const cents = frac.slice(0, 2);
  const wholeFmt = opts.compact
    ? whole.toString()
    : whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${wholeFmt}.${cents}`;
}

export const formatFiat = formatUSDm;

export function shortAddress(address: Address | string): string {
  if (!address) return "";
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatRelativeTime(timestamp: number): string {
  const delta = Date.now() - timestamp;
  const abs = Math.abs(delta);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return delta >= 0 ? "just now" : "soon";
  if (abs < hour) return `${Math.round(abs / minute)}m ${delta >= 0 ? "ago" : "left"}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${delta >= 0 ? "ago" : "left"}`;
  return `${Math.round(abs / day)}d ${delta >= 0 ? "ago" : "left"}`;
}

export function formatCountdown(msRemaining: number): string {
  if (msRemaining <= 0) return "expired";
  const minutes = Math.floor(msRemaining / 60_000);
  const seconds = Math.floor((msRemaining % 60_000) / 1000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${hours}h ${m}m`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

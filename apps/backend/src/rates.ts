import { isLosslessNumber, parse } from "lossless-json";
import { RelayError } from "./relay.js";

export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "NGN", "INR", "BRL", "ZAR", "KES"] as const;
export interface Quote { source: "coingecko"; currency: string; price: string; updatedAt: string; fetchedAt: string }

export class PublicRates {
  private cache = new Map<string, { quote: Quote; until: number }>();
  private pending = new Map<string, Promise<Quote>>();
  constructor(private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}
  async get(currency: string): Promise<Quote> {
    if (!(CURRENCIES as readonly string[]).includes(currency)) throw new RelayError(400, "This currency is not available for market quotes. Use manual ZEC entry.");
    const cached = this.cache.get(currency);
    if (cached && cached.until > this.now() && this.now() - Date.parse(cached.quote.updatedAt) <= 300000) return cached.quote;
    const running = this.pending.get(currency);
    if (running) return running;
    const request = this.load(currency).finally(() => this.pending.delete(currency));
    this.pending.set(currency, request);
    return request;
  }
  private async load(currency: string): Promise<Quote> {
    // 1. Try CoinGecko (with optional API key and descriptive User-Agent)
    try {
      const url = new URL("https://api.coingecko.com/api/v3/simple/price");
      url.search = new URLSearchParams({ ids: "zcash", vs_currencies: currency.toLowerCase(), include_last_updated_at: "true" }).toString();
      const headers: Record<string, string> = {
        accept: "application/json",
        "user-agent": "SplytRelay/1.0 (+https://splyttab.vercel.app)",
      };
      const apiKey = process.env.COINGECKO_API_KEY || process.env.CG_DEMO_API_KEY;
      if (apiKey) {
        headers["x-cg-demo-api-key"] = apiKey;
      }
      const response = await this.fetcher(url, { headers, signal: AbortSignal.timeout(8000) });
      if (response.ok) {
        const text = await response.text();
        if (text.length <= 10000) {
          const data = parse(text) as { zcash?: Record<string, unknown> };
          const price = data.zcash?.[currency.toLowerCase()];
          const updated = data.zcash?.last_updated_at;
          if (isLosslessNumber(price) && isLosslessNumber(updated) && /^\d+(?:\.\d{1,18})?$/.test(price.value) && price.value.length <= 40 && !/^0(?:\.0+)?$/.test(price.value) && /^\d{1,12}$/.test(updated.value)) {
            const updatedMs = Number(updated.value) * 1000;
            if (this.now() - updatedMs <= 300000 && updatedMs <= this.now() + 60000) {
              const quote: Quote = { source: "coingecko", currency, price: price.value, updatedAt: new Date(updatedMs).toISOString(), fetchedAt: new Date(this.now()).toISOString() };
              this.cache.set(currency, { quote, until: this.now() + 60000 });
              return quote;
            }
          }
        }
      }
    } catch {
      // Continue to keyless fallback
    }

    // 2. Fall back to CoinPaprika (keyless public endpoint, unblocked on datacenter IPs)
    try {
      const paprikaUrl = new URL("https://api.coinpaprika.com/v1/tickers/zec-zcash");
      paprikaUrl.search = new URLSearchParams({ quotes: currency.toUpperCase() }).toString();
      const response = await this.fetcher(paprikaUrl, {
        headers: { accept: "application/json", "user-agent": "SplytRelay/1.0 (+https://splyttab.vercel.app)" },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        const text = await response.text();
        if (text.length <= 10000) {
          const data = parse(text) as { quotes?: Record<string, { price?: unknown }>; last_updated?: unknown };
          const quoteEntry = data.quotes?.[currency.toUpperCase()];
          const price = quoteEntry?.price;
          if (isLosslessNumber(price) && /^\d+(?:\.\d{1,18})?$/.test(price.value) && price.value.length <= 40 && !/^0(?:\.0+)?$/.test(price.value)) {
            const updatedMs = typeof data.last_updated === "string" ? Date.parse(data.last_updated) : this.now();
            if (!Number.isNaN(updatedMs) && this.now() - updatedMs <= 300000 && updatedMs <= this.now() + 60000) {
              const quote: Quote = { source: "coingecko", currency, price: price.value, updatedAt: new Date(updatedMs).toISOString(), fetchedAt: new Date(this.now()).toISOString() };
              this.cache.set(currency, { quote, until: this.now() + 60000 });
              return quote;
            }
          }
        }
      }
    } catch {
      // Continue to final error
    }

    throw new RelayError(503, "Market information is unavailable. Enter and approve a manual ZEC total instead.");
  }
}

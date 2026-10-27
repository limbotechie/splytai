import type { EncryptedEnvelope } from "../private-workspace/crypto";
import { decodeBase64Url, hasExactKeys, isTimestamp } from "../private-workspace/format";
import { isUuid } from "../bills/manifest";
import { relayConfiguration } from "./config";

export interface RelayUpdate {
  id: string;
  envelope: EncryptedEnvelope;
  createdAt: string;
}

export interface RelayRequest {
  id: string;
  envelope: EncryptedEnvelope | null;
  revision: number;
  reports: RelayUpdate[];
  confirmations: RelayUpdate[];
  revoked: boolean;
  retainedUntil: string;
}

export interface RelayBill {
  id: string;
  envelope: EncryptedEnvelope | null;
  revision: number;
  retainedUntil: string;
  requests: RelayRequest[];
}

export interface RelayCreatedBill {
  id: string;
  editCapability: string;
  revision: number;
  retainedUntil: string;
}

export interface RelayReservation {
  id: string;
  revision: number;
  readCapability: string;
  reportCapability: string;
  retainedUntil: string;
}

export interface RelayWriteResult {
  id: string;
  revision: number;
  retainedUntil: string;
}

export interface RelayRateQuote {
  source: "coingecko";
  currency: string;
  price: string;
  updatedAt: string;
  fetchedAt: string;
}

export class RelayApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "RelayApiError";
  }
}

export interface RelayOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
const MAX_RESPONSE = 9 * 1024 * 1024;

function capability(value: unknown, label: string): string {
  if (typeof value !== "string" || !CAPABILITY.test(value) || decodeBase64Url(value).length !== 32) {
    throw new RelayApiError(0, `${label} is invalid.`, false);
  }
  return value;
}

function timestamp(value: unknown, label: string): string {
  if (!isTimestamp(value)) throw new RelayApiError(0, `${label} is invalid.`, false);
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new RelayApiError(0, "The relay revision is invalid.", false);
  return value;
}

function envelope(value: unknown): EncryptedEnvelope {
  if (!hasExactKeys(value, ["version", "kind", "recordId", "revision", "nonce", "ciphertext"]) ||
    value.version !== 1 || !["bill", "request", "report", "confirmation"].includes(value.kind as string) ||
    !isUuid(value.recordId) || typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 1 ||
    typeof value.nonce !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(value.nonce) ||
    typeof value.ciphertext !== "string" || !/^[A-Za-z0-9_-]{22,699051}$/.test(value.ciphertext) ||
    decodeBase64Url(value.nonce).length !== 12 || decodeBase64Url(value.ciphertext).length < 16) {
    throw new RelayApiError(0, "The relay returned an invalid encrypted envelope.", false);
  }
  return value as unknown as EncryptedEnvelope;
}

function update(value: unknown): RelayUpdate {
  if (!hasExactKeys(value, ["id", "envelope", "createdAt"]) || !isUuid(value.id)) {
    throw new RelayApiError(0, "The relay returned an invalid request update.", false);
  }
  const checked = envelope(value.envelope);
  if (checked.recordId !== value.id) throw new RelayApiError(0, "The relay returned an invalid request update.", false);
  return { id: value.id, envelope: checked, createdAt: timestamp(value.createdAt, "The update time") };
}

function request(value: unknown): RelayRequest {
  if (!hasExactKeys(value, ["id", "envelope", "revision", "reports", "confirmations", "revoked", "retainedUntil"]) || !isUuid(value.id)) {
    throw new RelayApiError(0, "The relay returned an invalid request.", false);
  }
  let checkedEnvelope: EncryptedEnvelope | null = null;
  if (value.envelope !== null) {
    checkedEnvelope = envelope(value.envelope);
    if (checkedEnvelope.recordId !== value.id) {
      throw new RelayApiError(0, "The relay returned an invalid encrypted envelope.", false);
    }
  }
  if (!Array.isArray(value.reports) || value.reports.length > 48 ||
    !Array.isArray(value.confirmations) || value.confirmations.length > 64 || typeof value.revoked !== "boolean") {
    throw new RelayApiError(0, "The relay returned an invalid request.", false);
  }
  return {
    id: value.id,
    envelope: checkedEnvelope,
    revision: revision(value.revision),
    reports: value.reports.map(update),
    confirmations: value.confirmations.map(update),
    revoked: value.revoked,
    retainedUntil: timestamp(value.retainedUntil, "The retention time"),
  };
}

function bill(value: unknown): RelayBill {
  if (!hasExactKeys(value, ["id", "envelope", "revision", "retainedUntil", "requests"]) || !isUuid(value.id)) {
    throw new RelayApiError(0, "The relay returned an invalid bill.", false);
  }
  let checkedEnvelope: EncryptedEnvelope | null = null;
  if (value.envelope !== null) {
    checkedEnvelope = envelope(value.envelope);
    if (checkedEnvelope.recordId !== value.id) {
      throw new RelayApiError(0, "The relay returned an invalid encrypted envelope.", false);
    }
  }
  if (!Array.isArray(value.requests) || value.requests.length > 150) throw new RelayApiError(0, "The relay returned an invalid bill.", false);
  return {
    id: value.id,
    envelope: checkedEnvelope,
    revision: revision(value.revision),
    retainedUntil: timestamp(value.retainedUntil, "The retention time"),
    requests: value.requests.map(request),
  };
}

/**
 * Typed relay client. Capabilities travel only in Authorization headers, responses
 * are never cached, redirects are refused, and errors never include request bodies.
 */
export class RelayClient {
  private readonly base: string | null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: RelayOptions) {
    const configuration = relayConfiguration(options.baseUrl);
    if (options.baseUrl?.trim() && configuration.error) throw new RelayApiError(0, configuration.error, false);
    this.base = configuration.baseUrl;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof this.fetchImpl !== "function") throw new RelayApiError(0, "This browser cannot contact the relay.", false);
  }

  get baseUrl(): string | null {
    return this.base;
  }

  private path(part: string): string {
    if (!this.base) {
      throw new RelayApiError(0, "The live relay is not configured. Set NEXT_PUBLIC_RELAY_URL to its HTTPS endpoint.", false);
    }
    return `${this.base}${part}`;
  }

  private async call<T>(method: string, part: string, token: string | null, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const response = await this.fetchImpl(this.path(part), {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      const text = await response.text();
      if (text.length > MAX_RESPONSE) throw new RelayApiError(0, "The relay response was too large.", false);
      let parsed: unknown = null;
      if (text) {
        try { parsed = JSON.parse(text); } catch { throw new RelayApiError(0, "The relay returned an unreadable response.", false); }
      }
      if (!response.ok) {
        const message = parsed && hasExactKeys(parsed, ["error"]) && typeof parsed.error === "string" && parsed.error.length <= 200
          ? parsed.error : "The relay request failed.";
        const retryAfter = Number(response.headers.get("retry-after"));
        throw new RelayApiError(
          response.status,
          message,
          response.status === 429 || response.status === 503 || response.status >= 500,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null,
        );
      }
      return parsed as T;
    } catch (error) {
      if (error instanceof RelayApiError) throw error;
      if (controller.signal.aborted) throw new RelayApiError(0, "The relay did not answer in time. Your local records are unchanged.", true);
      throw new RelayApiError(0, "The relay is unreachable. Your local records are unchanged.", true);
    } finally {
      clearTimeout(timeout);
    }
  }

  async health(): Promise<{ ok: true }> {
    const value = await this.call<unknown>("GET", "/api/health", null);
    if (!hasExactKeys(value, ["ok", "service", "apiVersion"]) || value.ok !== true || value.service !== "splyt-relay" || value.apiVersion !== 1) {
      throw new RelayApiError(0, "The relay health response is invalid. Check NEXT_PUBLIC_RELAY_URL and deploy the current Splyt relay.", false);
    }
    return { ok: true };
  }

  async rates(currency: string): Promise<RelayRateQuote> {
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new RelayApiError(0, "Choose a supported three-letter currency.", false);
    const value = await this.call<unknown>("GET", `/api/v1/rates?currency=${currency}`, null);
    if (!hasExactKeys(value, ["source", "currency", "price", "updatedAt", "fetchedAt"]) || value.source !== "coingecko" ||
      value.currency !== currency || typeof value.price !== "string" || !/^\d+(?:\.\d{1,18})?$/.test(value.price)) {
      throw new RelayApiError(0, "The relay returned an invalid rate quote.", false);
    }
    return {
      source: "coingecko", currency, price: value.price,
      updatedAt: timestamp(value.updatedAt, "The quote time"),
      fetchedAt: timestamp(value.fetchedAt, "The quote fetch time"),
    };
  }

  async createBill(input: { id: string; operationId: string }): Promise<RelayCreatedBill> {
    if (!isUuid(input.id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The bill reservation is invalid.", false);
    const value = await this.call<unknown>("POST", "/api/v1/bills", null, input);
    if (!hasExactKeys(value, ["id", "editCapability", "revision", "retainedUntil"]) || value.id !== input.id) {
      throw new RelayApiError(0, "The relay returned an invalid bill reservation.", false);
    }
    return {
      id: value.id as string,
      editCapability: capability(value.editCapability, "The edit capability"),
      revision: revision(value.revision),
      retainedUntil: timestamp(value.retainedUntil, "The retention time"),
    };
  }

  async getBill(id: string, editCapability: string): Promise<RelayBill> {
    if (!isUuid(id)) throw new RelayApiError(0, "The bill identifier is invalid.", false);
    return bill(await this.call<unknown>("GET", `/api/v1/bills/${id}`, capability(editCapability, "The edit capability")));
  }

  async updateBill(id: string, editCapability: string, input: { operationId: string; expectedRevision: number; envelope: EncryptedEnvelope }): Promise<RelayWriteResult> {
    if (!isUuid(id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The bill update is invalid.", false);
    envelope(input.envelope);
    const value = await this.call<unknown>("PATCH", `/api/v1/bills/${id}`, capability(editCapability, "The edit capability"), input);
    return this.writeResult(value, id);
  }

  async deleteBill(id: string, editCapability: string, input: { operationId: string; expectedRevision: number }): Promise<void> {
    if (!isUuid(id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The deletion is invalid.", false);
    await this.call<unknown>("DELETE", `/api/v1/bills/${id}`, capability(editCapability, "The edit capability"), input);
  }

  async reserveRequest(billId: string, editCapability: string, input: { id: string; operationId: string }): Promise<RelayReservation> {
    if (!isUuid(billId) || !isUuid(input.id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The request reservation is invalid.", false);
    const value = await this.call<unknown>("POST", `/api/v1/bills/${billId}/requests`, capability(editCapability, "The edit capability"), input);
    if (!hasExactKeys(value, ["id", "revision", "readCapability", "reportCapability", "retainedUntil"]) || value.id !== input.id) {
      throw new RelayApiError(0, "The relay returned an invalid request reservation.", false);
    }
    const readCapability = capability(value.readCapability, "The read capability");
    const reportCapability = capability(value.reportCapability, "The report capability");
    if (readCapability === reportCapability) throw new RelayApiError(0, "The relay issued dependent capabilities.", false);
    return { id: value.id as string, revision: revision(value.revision), readCapability, reportCapability, retainedUntil: timestamp(value.retainedUntil, "The retention time") };
  }

  async publishRequest(billId: string, editCapability: string, input: {
    id: string; operationId: string; expectedRevision: 0; envelope: EncryptedEnvelope;
  }): Promise<RelayWriteResult> {
    if (!isUuid(billId) || !isUuid(input.id) || !isUuid(input.operationId) || input.expectedRevision !== 0) {
      throw new RelayApiError(0, "The request publication is invalid.", false);
    }
    envelope(input.envelope);
    const value = await this.call<unknown>("POST", `/api/v1/bills/${billId}/requests`, capability(editCapability, "The edit capability"), input);
    return this.writeResult(value, input.id);
  }

  async getRequest(id: string, readCapability: string): Promise<RelayRequest> {
    if (!isUuid(id)) throw new RelayApiError(0, "The request identifier is invalid.", false);
    return request(await this.call<unknown>("GET", `/api/v1/requests/${id}`, capability(readCapability, "The read capability")));
  }

  async reportPayment(id: string, reportCapability: string, input: {
    operationId: string; expectedRevision: number; envelope: EncryptedEnvelope;
  }): Promise<RelayWriteResult> {
    if (!isUuid(id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The payment report is invalid.", false);
    envelope(input.envelope);
    const value = await this.call<unknown>("POST", `/api/v1/requests/${id}/reports`, capability(reportCapability, "The report capability"), input);
    return this.writeResult(value, id);
  }

  async putConfirmation(id: string, editCapability: string, input: {
    operationId: string; expectedRevision: number; envelope: EncryptedEnvelope;
  }): Promise<RelayWriteResult> {
    if (!isUuid(id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The confirmation is invalid.", false);
    envelope(input.envelope);
    const value = await this.call<unknown>("PUT", `/api/v1/requests/${id}/confirmation`, capability(editCapability, "The edit capability"), input);
    return this.writeResult(value, id);
  }

  async revokeRequest(id: string, editCapability: string, input: { operationId: string; expectedRevision: number }): Promise<RelayWriteResult> {
    if (!isUuid(id) || !isUuid(input.operationId)) throw new RelayApiError(0, "The revocation is invalid.", false);
    const value = await this.call<unknown>("POST", `/api/v1/requests/${id}/revoke`, capability(editCapability, "The edit capability"), input);
    return this.writeResult(value, id);
  }

  private writeResult(value: unknown, expectedId: string): RelayWriteResult {
    if (!hasExactKeys(value, ["id", "revision", "retainedUntil"]) || value.id !== expectedId) {
      throw new RelayApiError(0, "The relay returned an invalid write result.", false);
    }
    return { id: expectedId, revision: revision(value.revision), retainedUntil: timestamp(value.retainedUntil, "The retention time") };
  }
}

/** Exponential backoff for polling while a screen is active; never polls in the background. */
export function retryDelay(attempt: number, error: RelayApiError | null): number {
  if (error?.retryAfterMs) return Math.min(error.retryAfterMs, 60_000);
  return Math.min(1_000 * 2 ** Math.max(0, Math.min(attempt, 5)), 30_000);
}

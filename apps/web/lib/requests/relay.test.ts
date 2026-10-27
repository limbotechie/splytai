import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RelayApiError, RelayClient, retryDelay, type RelayOptions } from "./relay";
import { encryptJson, randomId, randomSecret } from "../private-workspace/crypto";
import { installCrypto } from "../private-workspace/test-support";

interface Recorded { url: string; init: RequestInit }

function respond(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function harness(handler: (url: string, init: RequestInit) => Response | Promise<Response>, overrides: Partial<RelayOptions> = {}) {
  const calls: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return handler(String(input), init ?? {});
  }) as typeof fetch;
  return { calls, client: new RelayClient({ baseUrl: "https://relay.example", fetchImpl, timeoutMs: 500, ...overrides }) };
}

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function envelope(kind: "bill" | "request" | "report" | "confirmation", recordId = randomId(), revision = 1) {
  return encryptJson(randomSecret(), { kind, recordId, revision }, { kind, recordId, revision });
}

describe("relay URL and transport hardening", () => {
  it("requires HTTPS except on loopback and refuses credentials or query strings", () => {
    for (const baseUrl of ["not a URL", "http://relay.example", "https://user:pass@relay.example", "https://relay.example?key=1", "https://relay.example#frag"]) {
      expect(() => new RelayClient({ baseUrl, fetchImpl: vi.fn() as unknown as typeof fetch })).toThrow(RelayApiError);
    }
    expect(() => new RelayClient({ baseUrl: "http://localhost:4000", fetchImpl: vi.fn() as unknown as typeof fetch })).not.toThrow();
    expect(() => new RelayClient({ baseUrl: "https://relay.example/", fetchImpl: vi.fn() as unknown as typeof fetch })).not.toThrow();
  });

  it("rejects loopback endpoints in a production deployment", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const baseUrl of ["http://localhost:3001", "https://localhost:3001", "http://127.0.0.1:3001", "https://[::1]:3001"]) {
      expect(() => new RelayClient({ baseUrl, fetchImpl: vi.fn() as unknown as typeof fetch })).toThrow(RelayApiError);
    }
  });

  it("fails explicitly when no live relay endpoint is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new RelayClient({ fetchImpl });
    expect(client.baseUrl).toBeNull();
    await expect(client.health()).rejects.toThrow(/live relay is not configured.*NEXT_PUBLIC_RELAY_URL/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends capabilities only as authorization headers and never caches or follows redirects", async () => {
    const capability = randomSecret();
    const { calls, client } = harness(() => respond({ ok: true, service: "splyt-relay", apiVersion: 1 }));
    await client.health();
    expect(calls[0].url).toBe("https://relay.example/api/health");
    expect(calls[0].init).toMatchObject({
      method: "GET", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();

    const second = harness(() => respond({
      id: randomId(), envelope: null, revision: 0,
      retainedUntil: "2026-04-01T00:00:00.000Z", requests: [],
    }), {});
    const id = randomId();
    await second.client.getBill(id, capability);
    expect((second.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${capability}`);
    expect(second.calls[0].url).toBe(`https://relay.example/api/v1/bills/${id}`);
  });

  it("reports an unreachable relay without leaking the request body", async () => {
    const { client } = harness(() => { throw new TypeError("network down"); });
    await expect(client.health()).rejects.toMatchObject({ status: 0, retryable: true });
    await expect(client.health()).rejects.toThrow(/unreachable.*local records are unchanged/);
  });

  it("times out a stalled relay", async () => {
    const client = new RelayClient({
      baseUrl: "https://relay.example",
      timeoutMs: 10,
      fetchImpl: ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })) as typeof fetch,
    });
    await expect(client.health()).rejects.toMatchObject({ status: 0, retryable: true });
    await expect(client.health()).rejects.toThrow(/did not answer in time/);
  });

  it("rejects unreadable or oversized-shape responses", async () => {
    const broken = harness(() => new Response("not json", { status: 200 }));
    await expect(broken.client.health()).rejects.toThrow(/unreadable/);

    const surprising = harness(() => respond({ ok: true, extra: 1 }));
    await expect(surprising.client.health()).rejects.toThrow(/health response is invalid/);
  });

  it("does not treat another service or an old unconditional health response as relay readiness", async () => {
    for (const response of [
      { ok: true },
      { ok: false, service: "splyt-relay", apiVersion: 1 },
      { ok: true, service: "another-service", apiVersion: 1 },
      { ok: true, service: "splyt-relay", apiVersion: 2 },
    ]) {
      const { client } = harness(() => respond(response));
      await expect(client.health()).rejects.toThrow(/health response is invalid/);
    }
  });
});

describe("typed relay calls", () => {
  it("creates and reads a bill with validated capabilities", async () => {
    const id = randomId();
    const editCapability = randomSecret();
    const create = harness(() => respond({ id, editCapability, revision: 0, retainedUntil: "2026-04-01T00:00:00.000Z" }, 201));
    const created = await create.client.createBill({ id, operationId: randomId() });
    expect(created.editCapability).toBe(editCapability);
    expect(create.calls[0].init.method).toBe("POST");
    expect(JSON.parse(String(create.calls[0].init.body))).toMatchObject({ id });

    const envelopeValue = await envelope("bill", id, 1);
    const read = harness(() => respond({ id, envelope: envelopeValue, revision: 1, retainedUntil: "2026-04-01T00:00:00.000Z", requests: [] }));
    const bill = await read.client.getBill(id, editCapability);
    expect(bill.envelope).toEqual(envelopeValue);
    expect(bill.requests).toEqual([]);
  });

  it("rejects a bill envelope for another record or an invalid revision", async () => {
    const id = randomId();
    const foreign = await envelope("request", randomId(), 1);
    const wrong = harness(() => respond({
      id, envelope: null, revision: 1, retainedUntil: "2026-04-01T00:00:00.000Z",
      requests: [{ id: randomId(), envelope: foreign, revision: 1, reports: [], confirmations: [], revoked: false, retainedUntil: "2026-04-01T00:00:00.000Z" }],
    }));
    await expect(wrong.client.getBill(id, randomSecret())).rejects.toThrow(/invalid encrypted envelope/);

    const badRevision = harness(() => respond({ id, envelope: null, revision: -1, retainedUntil: "2026-04-01T00:00:00.000Z", requests: [] }));
    await expect(badRevision.client.getBill(id, randomSecret())).rejects.toThrow(/revision/);
  });

  it("reserves a request and refuses dependent capabilities", async () => {
    const billId = randomId();
    const requestId = randomId();
    const readCapability = randomSecret();
    const reportCapability = randomSecret();
    const ok = harness(() => respond({ id: requestId, revision: 0, readCapability, reportCapability, retainedUntil: "2026-04-01T00:00:00.000Z" }, 201));
    const reserved = await ok.client.reserveRequest(billId, randomSecret(), { id: requestId, operationId: randomId() });
    expect(reserved).toMatchObject({ id: requestId, readCapability, reportCapability });
    expect(ok.calls[0].url).toBe(`https://relay.example/api/v1/bills/${billId}/requests`);

    const dependent = harness(() => respond({ id: requestId, revision: 0, readCapability, reportCapability: readCapability, retainedUntil: "2026-04-01T00:00:00.000Z" }, 201));
    await expect(dependent.client.reserveRequest(billId, randomSecret(), { id: requestId, operationId: randomId() }))
      .rejects.toThrow(/dependent capabilities/);
  });

  it("publishes, reports, confirms and revokes with revisioned envelopes", async () => {
    const billId = randomId();
    const requestId = randomId();
    const target = async (body: unknown) => respond(body, 201);

    const publish = harness(() => target({ id: requestId, revision: 1, retainedUntil: "2026-04-01T00:00:00.000Z" }));
    await expect(publish.client.publishRequest(billId, randomSecret(), {
      id: requestId, operationId: randomId(), expectedRevision: 0,
      envelope: await envelope("request", requestId, 1),
    })).resolves.toMatchObject({ id: requestId, revision: 1 });
    expect(publish.calls[0].init.method).toBe("POST");

    const report = harness(() => target({ id: requestId, revision: 2, retainedUntil: "2026-04-01T00:00:00.000Z" }));
    await report.client.reportPayment(requestId, randomSecret(), {
      operationId: randomId(), expectedRevision: 1, envelope: await envelope("report", randomId(), 2),
    });
    expect(report.calls[0].url).toBe(`https://relay.example/api/v1/requests/${requestId}/reports`);

    const confirmation = harness(() => respond({ id: requestId, revision: 3, retainedUntil: "2026-04-01T00:00:00.000Z" }));
    await confirmation.client.putConfirmation(requestId, randomSecret(), {
      operationId: randomId(), expectedRevision: 2, envelope: await envelope("confirmation", randomId(), 3),
    });
    expect(confirmation.calls[0].init.method).toBe("PUT");
    expect(confirmation.calls[0].url).toBe(`https://relay.example/api/v1/requests/${requestId}/confirmation`);

    const revoke = harness(() => respond({ id: requestId, revision: 4, retainedUntil: "2026-04-01T00:00:00.000Z" }));
    await revoke.client.revokeRequest(requestId, randomSecret(), { operationId: randomId(), expectedRevision: 3 });
    expect(revoke.calls[0].init.method).toBe("POST");
    expect(revoke.calls[0].url).toBe(`https://relay.example/api/v1/requests/${requestId}/revoke`);
  });

  it("validates rate quotes and currency codes", async () => {
    const ok = harness(() => respond({ source: "coingecko", currency: "USD", price: "42.5", updatedAt: "2026-03-01T10:00:00.000Z", fetchedAt: "2026-03-01T10:00:10.000Z" }));
    await expect(ok.client.rates("USD")).resolves.toMatchObject({ currency: "USD", price: "42.5" });
    expect(ok.calls[0].url).toBe("https://relay.example/api/v1/rates?currency=USD");
    await expect(ok.client.rates("usd")).rejects.toThrow(/three-letter currency/);

    const bad = harness(() => respond({ source: "coingecko", currency: "USD", price: "-1", updatedAt: "2026-03-01T10:00:00.000Z", fetchedAt: "2026-03-01T10:00:10.000Z" }));
    await expect(bad.client.rates("USD")).rejects.toThrow(/invalid rate quote/);
  });
});

describe("relay error mapping and backoff", () => {
  it("maps private errors without exposing bodies", async () => {
    const conflict = harness(() => respond({ error: "This record changed. Refresh before trying again." }, 409));
    await expect(conflict.client.health()).rejects.toMatchObject({ status: 409, retryable: false });

    const unavailable = harness(() => respond({ error: "The relay is unavailable." }, 503));
    await expect(unavailable.client.health()).rejects.toMatchObject({ status: 503, retryable: true });

    const limited = harness(() => respond({ error: "Too many requests." }, 429, { "retry-after": "2" }));
    await expect(limited.client.health()).rejects.toMatchObject({ status: 429, retryable: true, retryAfterMs: 2000 });

    const opaque = harness(() => new Response("not json", { status: 500 }));
    await expect(opaque.client.health()).rejects.toThrow(/unreadable/);
  });

  it("backs off exponentially and honours retry-after up to a minute", () => {
    expect(retryDelay(0, null)).toBe(1_000);
    expect(retryDelay(1, null)).toBe(2_000);
    expect(retryDelay(4, null)).toBe(16_000);
    expect(retryDelay(5, null)).toBe(30_000);
    expect(retryDelay(12, null)).toBe(30_000);
    expect(retryDelay(0, new RelayApiError(429, "slow down", true, 5_000))).toBe(5_000);
    expect(retryDelay(0, new RelayApiError(429, "slow down", true, 120_000))).toBe(60_000);
    expect(retryDelay(0, new RelayApiError(500, "boom", true, 0))).toBe(1_000);
  });
});

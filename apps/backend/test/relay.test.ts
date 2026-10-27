import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import request from "supertest";
import { createApp } from "../src/app.js";
import { authorised, hash, RelayStore, RETENTION_MS, type Envelope } from "../src/relay.js";
import { PublicRates } from "../src/rates.js";

let mongo: MongoMemoryServer;
let client: MongoClient;
let store: RelayStore;
let app: ReturnType<typeof createApp>;
let clock = Date.now();
const envelope = (kind: Envelope["kind"], recordId: string, revision: number): Envelope => ({ version: 1, kind, recordId, revision, nonce: randomBytes(12).toString("base64url"), ciphertext: randomBytes(64).toString("base64url") });
const auth = (capability: string) => `Bearer ${capability}`;
async function bill() {
  const id = randomUUID();
  const reserved = await request(app).post("/api/v1/bills").send({ id, operationId: randomUUID() }).expect(201);
  const edit = reserved.body.editCapability as string;
  await request(app).patch(`/api/v1/bills/${id}`).set("Authorization", auth(edit)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("bill", id, 1) }).expect(200);
  return { id, edit };
}
async function child(parent: Awaited<ReturnType<typeof bill>>) {
  const id = randomUUID();
  const reserved = await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id, operationId: randomUUID() }).expect(201);
  const body = { id, operationId: randomUUID(), expectedRevision: 0, envelope: envelope("request", id, 1) };
  await request(app).get(`/api/v1/requests/${id}`).set("Authorization", auth(reserved.body.readCapability)).expect(404);
  await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send(body).expect(201);
  return { id, read: reserved.body.readCapability as string, report: reserved.body.reportCapability as string, publish: body };
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri());
  store = new RelayStore(client.db("splyt_private_integration"), () => clock); await store.initialise();
  app = createApp(store, { webOrigin: "http://localhost:3000", rateLimitMax: 10000 });
});
beforeEach(async () => { clock = Date.now(); await store.collection.deleteMany({}); });
afterAll(async () => { await client?.close(); await mongo?.stop(); });

// ---------------------------------------------------------------------------
// Original suite (unchanged)
// ---------------------------------------------------------------------------

describe("capability-scoped encrypted relay with real MongoDB", () => {
  it("reports relay readiness only after a real database request", async () => {
    const response = await request(app).get("/api/health").expect(200);
    expect(response.body).toEqual({ ok: true, service: "splyt-relay", apiVersion: 1 });
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("does not report ready after its database connection closes", async () => {
    const disconnectedClient = await MongoClient.connect(mongo.getUri());
    const disconnectedStore = new RelayStore(disconnectedClient.db("splyt_private_health_test"));
    const disconnectedApp = createApp(disconnectedStore, { webOrigin: "http://localhost:3000" });
    await disconnectedClient.close();

    const response = await request(disconnectedApp).get("/api/health").expect(503);
    expect(response.body).toEqual({ error: "The relay is unavailable. Your local records have not been cleared." });
    expect(JSON.stringify(response.body)).not.toMatch(/Mongo|splyt_private_health_test|localhost/);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
  it("has no listing or unauthenticated reads, and no token hashes in responses", async () => {
    const parent = await bill(); const first = await child(parent); const second = await child(parent);
    for (const path of ["/api/v1/bills", "/api/v1/requests", `/api/v1/bills/${parent.id}`, `/api/v1/requests/${first.id}`, `/api/v1/requests/${randomUUID()}`]) {
      const response = await request(app).get(path).expect(404); expect(response.body).toEqual({ error: "Record not found." });
    }
    await request(app).get(`/api/v1/requests/${second.id}`).set("Authorization", auth(first.read)).expect(404);
    const response = await request(app).get(`/api/v1/requests/${first.id}`).set("Authorization", auth(first.read)).expect(200);
    expect(JSON.stringify(response.body)).not.toContain(second.id);
    expect(JSON.stringify(response.body)).not.toMatch(/Hash|Capability|billId/);
    expect(response.headers["cache-control"]).toBe("no-store");
    const stored = await store.collection.findOne({ _id: parent.id });
    expect(JSON.stringify(stored)).not.toContain(parent.edit); expect(JSON.stringify(stored)).not.toContain(first.read);
  });
  it("separates read, report and organiser-confirmation capabilities", async () => {
    const parent = await bill(); const other = await bill(); const item = await child(parent);
    const body = { operationId: randomUUID(), expectedRevision: 1, envelope: envelope("report", randomUUID(), 2) };
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.read)).send(body).expect(404);
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.report)).expect(404);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send(body).expect(201);
    const confirmation = { operationId: randomUUID(), expectedRevision: 2, envelope: envelope("confirmation", randomUUID(), 3) };
    for (const wrong of [item.read, item.report, other.edit]) await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(wrong)).send(confirmation).expect(404);
    await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(parent.edit)).send(confirmation).expect(200);
  });
  it("makes publication and reports idempotent while rejecting stale and conflicting writes", async () => {
    const parent = await bill(); const item = await child(parent);
    await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send(item.publish).expect(200);
    const body = { operationId: randomUUID(), expectedRevision: 1, envelope: envelope("report", randomUUID(), 2) };
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send(body).expect(201);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send(body).expect(200);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ ...body, operationId: randomUUID() }).expect(409);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ ...body, envelope: envelope("report", randomUUID(), 2) }).expect(409);
    const current = await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read));
    expect(current.body.reports).toHaveLength(1);
    await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: item.id, operationId: randomUUID() }).expect(409);
  });
  it("validates envelope binding, size, schema, CORS and owner relationship", async () => {
    const parent = await bill(); const other = await bill(); const item = await child(parent);
    await request(app).post(`/api/v1/bills/${other.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: randomUUID(), operationId: randomUUID() }).expect(404);
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: envelope("bill", randomUUID(), 2) }).expect(400);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: { ...envelope("report", randomUUID(), 2), ciphertext: randomBytes(4096).toString("base64url") } }).expect(400);
    await request(app).post("/api/v1/bills").send({ id: randomUUID(), operationId: randomUUID(), title: "Never accept plaintext" }).expect(400);
    await request(app).get("/api/health").set("Origin", "https://unexpected.example").expect(403);
  });
  it("does not extend retention for reports and denies children after expiry", async () => {
    const parent = await bill(); const item = await child(parent);
    const before = (await store.bill(parent.id)).expiresAt.getTime(); clock += RETENTION_MS - 1000;
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: envelope("report", randomUUID(), 2) }).expect(201);
    expect((await store.bill(parent.id)).expiresAt.getTime()).toBe(before);
    clock += 1001;
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).expect(404);
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read)).expect(404);
    expect((await store.collection.indexes()).some((index) => index.expireAfterSeconds === 0)).toBe(true);
  });
  it("revokes request access and atomically deletes all child records with a bill", async () => {
    const parent = await bill(); const item = await child(parent);
    await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(200);
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read)).expect(404);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({}).expect(404);
    await request(app).delete(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(204);
    expect(await store.collection.countDocuments()).toBe(0);
  });
  it("returns real rate-limit responses", async () => {
    const limited = createApp(store, { webOrigin: "http://localhost:3000", rateLimitMax: 1 });
    await request(limited).post("/api/v1/bills").send({ id: randomUUID(), operationId: randomUUID() }).expect(201);
    await request(limited).post("/api/v1/bills").send({ id: randomUUID(), operationId: randomUUID() }).expect(429);
  });
});

describe("public market adapter", () => {
  it("sends only a fixed coin and allowed currency, caches60s and rejects stale data", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls++; const target = new URL(String(url));
      expect(target.origin).toBe("https://api.coingecko.com"); expect(target.searchParams.get("ids")).toBe("zcash");
      expect([...target.searchParams.keys()].sort()).toEqual(["ids", "include_last_updated_at", "vs_currencies"]);
      expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBeUndefined();
      return new Response(`{"zcash":{"usd":37.510000000000001,"last_updated_at":${Math.floor(clock / 1000)}}}`);
    };
    const provider = new PublicRates(fetcher, () => clock);
    expect((await provider.get("USD")).price).toBe("37.510000000000001"); await provider.get("USD"); expect(calls).toBe(1);
    clock += 60001; await provider.get("USD"); expect(calls).toBe(2);
    await expect(provider.get("XXX")).rejects.toThrow(/manual ZEC/);
    const stale = new PublicRates(async () => new Response('{"zcash":{"usd":1,"last_updated_at":1}}'), () => clock);
    await expect(stale.get("USD")).rejects.toThrow(/unavailable/);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 hardening additions
// ---------------------------------------------------------------------------

describe("negative authorisation: all wrong-token paths return indistinguishable 404s", () => {
  it("rejects bill GET/PATCH/DELETE with wrong, absent, and malformed tokens", async () => {
    const parent = await bill();
    const wrongCap = randomBytes(32).toString("base64url");
    const shortCap = randomBytes(16).toString("base64url");
    // GET with wrong capability
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(wrongCap)).expect(404);
    // GET with no Authorization header at all
    await request(app).get(`/api/v1/bills/${parent.id}`).expect(404);
    // GET with malformed token (too short)
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", `Bearer ${shortCap}`).expect(404);
    // GET with wrong scheme
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", `Basic ${parent.edit}`).expect(404);
    // PATCH with wrong capability
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(wrongCap)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: envelope("bill", parent.id, 2) }).expect(404);
    // DELETE with wrong capability
    await request(app).delete(`/api/v1/bills/${parent.id}`).set("Authorization", auth(wrongCap)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(404);
  });

  it("rejects request read and report with each other's token and with the organiser token", async () => {
    const parent = await bill(); const item = await child(parent);
    // Read with organiser token returns 404 (not 200)
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(parent.edit)).expect(404);
    // Read with report token returns 404
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.report)).expect(404);
    // Report with organiser token returns 404
    const body = { operationId: randomUUID(), expectedRevision: 1, envelope: envelope("report", randomUUID(), 2) };
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(parent.edit)).send(body).expect(404);
    // Revoke with read token returns 404
    await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(item.read)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(404);
    // Revoke with report token returns 404
    await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(404);
  });

  it("returns 404 for unknown bill IDs regardless of which capability is presented", async () => {
    const parent = await bill();
    const nonExistent = randomUUID();
    await request(app).get(`/api/v1/bills/${nonExistent}`).set("Authorization", auth(parent.edit)).expect(404);
    await request(app).patch(`/api/v1/bills/${nonExistent}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("bill", nonExistent, 1) }).expect(404);
  });

  it("returns 404 for all non-UUID and path-traversal IDs", async () => {
    for (const badId of ["../etc/passwd", "' OR 1=1--", "", "not-a-uuid", "00000000-0000-0000-0000-000000000000"]) {
      await request(app).get(`/api/v1/requests/${encodeURIComponent(badId)}`).set("Authorization", auth(randomBytes(32).toString("base64url"))).expect(404);
    }
  });
});

describe("revision and concurrency guards", () => {
  it("rejects PATCH with wrong expectedRevision (stale write)", async () => {
    const parent = await bill();
    // revision is currently 1 — attempt to write with expectedRevision=0 (stale)
    const res = await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("bill", parent.id, 1) }).expect(409);
    expect(res.body.error).toMatch(/changed/i);
  });

  it("rejects DELETE with wrong expectedRevision", async () => {
    const parent = await bill();
    // revision is 1; delete with expectedRevision=0
    await request(app).delete(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 0 }).expect(409);
    // bill still exists
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).expect(200);
  });

  it("rejects report with wrong expectedRevision", async () => {
    const parent = await bill(); const item = await child(parent);
    // item is at revision 1; send expectedRevision=0
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("report", randomUUID(), 1) }).expect(409);
    // send expectedRevision=2 (ahead)
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 2, envelope: envelope("report", randomUUID(), 3) }).expect(409);
  });

  it("rejects confirmation with wrong expectedRevision", async () => {
    const parent = await bill(); const item = await child(parent);
    // item at revision 1; send expectedRevision=0
    await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("confirmation", randomUUID(), 1) }).expect(409);
  });

  it("detects storageRevision concurrency conflict using simulated race", async () => {
    // Load two copies of the same bill document and attempt concurrent saves.
    const parent = await bill();
    const billA = await store.bill(parent.id);
    const billB = await store.bill(parent.id);
    // Save the first copy — succeeds
    store.renew(billA);
    await store.save(billA);
    // Save the second copy — storageRevision is now stale => 409
    store.renew(billB);
    await expect(store.save(billB)).rejects.toThrow(/changed/i);
  });
});

describe("revocation races and post-revoke access", () => {
  it("blocks read, report, confirmation and re-revocation after a request is revoked", async () => {
    const parent = await bill(); const item = await child(parent);
    // Revoke with a stable operationId so we can replay it
    const revokeOpId = randomUUID();
    const revokeResult = await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(parent.edit)).send({ operationId: revokeOpId, expectedRevision: 1 }).expect(200);
    // Idempotent replay of the same revoke returns the same result
    const replayed = await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(parent.edit)).send({ operationId: revokeOpId, expectedRevision: 1 }).expect(200);
    expect(replayed.body.revision).toBe(revokeResult.body.revision);
    // Subsequent read returns 404
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read)).expect(404);
    // Subsequent report returns 404
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 2, envelope: envelope("report", randomUUID(), 3) }).expect(404);
    // Subsequent confirmation returns 404 (revokedAt guard added in Phase 3 hardening)
    await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 2, envelope: envelope("confirmation", randomUUID(), 3) }).expect(404);
    // A new revoke attempt with a different operationId conflicts (revision already advanced)
    await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(409);
  });

  it("blocks new requests being reserved against a revoked request slot (re-reserve is not allowed after revoke)", async () => {
    const parent = await bill(); const item = await child(parent);
    await request(app).post(`/api/v1/requests/${item.id}/revoke`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(200);
    // Attempting to re-reserve with the same id after revoke returns 409
    await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: item.id, operationId: randomUUID() }).expect(409);
  });
});

describe("request lifecycle gates", () => {
  it("blocks request creation before bill manifest is saved", async () => {
    // Create a bill without patching it (no manifest yet)
    const id = randomUUID();
    const reserved = await request(app).post("/api/v1/bills").send({ id, operationId: randomUUID() }).expect(201);
    const edit = reserved.body.editCapability as string;
    // Attempting to create a request on an un-manifested bill returns 409
    await request(app).post(`/api/v1/bills/${id}/requests`).set("Authorization", auth(edit)).send({ id: randomUUID(), operationId: randomUUID() }).expect(409);
  });

  it("blocks read and report before a request envelope is published", async () => {
    // Reserve but do not publish
    const parent = await bill();
    const requestId = randomUUID();
    const res = await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: requestId, operationId: randomUUID() }).expect(201);
    const readCap = res.body.readCapability as string;
    const reportCap = res.body.reportCapability as string;
    // Read returns 404 (not yet published)
    await request(app).get(`/api/v1/requests/${requestId}`).set("Authorization", auth(readCap)).expect(404);
    // Report returns 404 (not yet published)
    await request(app).post(`/api/v1/requests/${requestId}/reports`).set("Authorization", auth(reportCap)).send({ operationId: randomUUID(), expectedRevision: 0, envelope: envelope("report", randomUUID(), 1) }).expect(404);
  });

  it("rotates capabilities when a reserved-but-unpublished request is re-reserved", async () => {
    const parent = await bill();
    const requestId = randomUUID();
    const first = await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: requestId, operationId: randomUUID() }).expect(201);
    const firstReadCap = first.body.readCapability as string;
    // Re-reserve the same id (not yet published, not revoked)
    const second = await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: requestId, operationId: randomUUID() }).expect(201);
    const secondReadCap = second.body.readCapability as string;
    // Capabilities rotate — the old read key must no longer grant access after publication
    expect(firstReadCap).not.toBe(secondReadCap);
    // Publish the request using the second reservation's revision expectation (0)
    await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: requestId, operationId: randomUUID(), expectedRevision: 0, envelope: envelope("request", requestId, 1) }).expect(201);
    // Old cap no longer works
    await request(app).get(`/api/v1/requests/${requestId}`).set("Authorization", auth(firstReadCap)).expect(404);
    // New cap works
    await request(app).get(`/api/v1/requests/${requestId}`).set("Authorization", auth(secondReadCap)).expect(200);
  });
});

describe("response body and stored-document hygiene", () => {
  it("never includes hash or capability fields in public request or bill responses", async () => {
    const parent = await bill(); const item = await child(parent);
    const billResp = await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).expect(200);
    const billJson = JSON.stringify(billResp.body);
    expect(billJson).not.toMatch(/Hash|Capability|editHash|readHash|reportHash/);
    const reqResp = await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read)).expect(200);
    const reqJson = JSON.stringify(reqResp.body);
    expect(reqJson).not.toMatch(/Hash|Capability|editHash|readHash|reportHash/);
    // The stored document must not contain raw capability values
    const stored = await store.collection.findOne({ _id: parent.id });
    expect(JSON.stringify(stored)).not.toContain(parent.edit);
    expect(JSON.stringify(stored)).not.toContain(item.read);
    expect(JSON.stringify(stored)).not.toContain(item.report);
  });

  it("stores capability hashes, not capability values, in the database", async () => {
    const parent = await bill();
    const stored = await store.collection.findOne({ _id: parent.id });
    expect(stored).not.toBeNull();
    // editHash is a SHA-256 hex string
    expect(stored!.editHash).toMatch(/^[0-9a-f]{64}$/);
    // authorised() uses the hash correctly
    expect(authorised(parent.edit, stored!.editHash)).toBe(true);
    expect(authorised(randomBytes(32).toString("base64url"), stored!.editHash)).toBe(false);
  });
});

describe("response security headers on all routes", () => {
  it("sets no-store, no-referrer, nosniff, frame-deny and CSP on every response", async () => {
    const parent = await bill();
    for (const res of [
      await request(app).get("/api/health"),
      await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)),
      await request(app).get(`/api/v1/bills/${randomUUID()}`), // 404 path
    ]) {
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
    }
  });

  it("includes Vary: Origin on CORS responses", async () => {
    const parent = await bill();
    const res = await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).set("Origin", "http://localhost:3000").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["vary"]).toContain("Origin");
  });

  it("handles OPTIONS preflight with 204 and correct CORS headers", async () => {
    const res = await request(app).options("/api/v1/bills").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "POST").expect(204);
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
    expect(res.headers["access-control-allow-headers"]).toContain("Authorization");
  });

  it("allows requests from the configured origin and rejects all others", async () => {
    await request(app).get("/api/health").set("Origin", "http://localhost:3000").expect(200);
    await request(app).get("/api/health").set("Origin", "https://attacker.example").expect(403);
    await request(app).get("/api/health").set("Origin", "http://localhost:3001").expect(403);
    // No Origin header (non-browser curl / server-to-server) is not blocked — CORS is a browser mechanism
    await request(app).get("/api/health").expect(200);
  });

  it("does not expose x-powered-by header", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("CORS: same-origin vs cross-origin distinction", () => {
  it("reflects the configured origin in Access-Control-Allow-Origin, not a wildcard", async () => {
    const parent = await bill();
    const res = await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).set("Origin", "http://localhost:3000").expect(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });
});

describe("envelope validation hardening", () => {
  it("rejects envelopes with wrong kind for the endpoint", async () => {
    const parent = await bill(); const item = await child(parent);
    // Post a "bill" envelope to a report endpoint
    const wrongKind = envelope("bill", randomUUID(), 2);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: wrongKind }).expect(400);
    // Post a "report" envelope to the bill PATCH endpoint
    const wrongKind2 = envelope("report", parent.id, 2);
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: wrongKind2 }).expect(400);
  });

  it("rejects envelopes with mismatched recordId", async () => {
    const parent = await bill();
    // Envelope recordId does not match the bill id
    const e = envelope("bill", randomUUID(), 2);
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: e }).expect(400);
  });

  it("rejects envelopes with wrong revision", async () => {
    const parent = await bill();
    // revision should be 2 (bill is at 1), sending 3 is wrong
    const e = envelope("bill", parent.id, 3);
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: e }).expect(400);
  });

  it("rejects ciphertext with non-base64url characters", async () => {
    const parent = await bill();
    const bad = { version: 1, kind: "bill", recordId: parent.id, revision: 2, nonce: randomBytes(12).toString("base64url"), ciphertext: "====not+base64url====" };
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: bad }).expect(400);
  });

  it("rejects non-canonical base64url (padding characters)", async () => {
    const parent = await bill();
    // Generate valid ciphertext then corrupt it with padding
    const validBytes = randomBytes(64);
    const padded = validBytes.toString("base64"); // standard base64 with '=' and '+'
    const e = { version: 1, kind: "bill", recordId: parent.id, revision: 2, nonce: randomBytes(12).toString("base64url"), ciphertext: padded };
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1, envelope: e }).expect(400);
  });

  it("rejects oversized JSON body (>600kb)", async () => {
    const parent = await bill();
    const giant = "x".repeat(700 * 1024);
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).set("Content-Type", "application/json").send(`{"operationId":"${randomUUID()}","expectedRevision":1,"envelope":{"version":1,"kind":"bill","recordId":"${parent.id}","revision":2,"nonce":"${randomBytes(12).toString("base64url")}","ciphertext":"${giant}"}}`).expect(413);
  });
});

describe("size and rate limits", () => {
  it("rejects requests once bill reaches 150 request-history entries", async () => {
    const parent = await bill();
    // Push 150 entries via reservation (not publish) — faster than full publish
    for (let i = 0; i < 150; i++) {
      await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: randomUUID(), operationId: randomUUID() }).expect(201);
    }
    await request(app).post(`/api/v1/bills/${parent.id}/requests`).set("Authorization", auth(parent.edit)).send({ id: randomUUID(), operationId: randomUUID() }).expect(413);
  });

  it("rejects confirmation once request reaches 64 confirmations", async () => {
    const parent = await bill(); const item = await child(parent);
    let rev = 1;
    for (let i = 0; i < 64; i++) {
      await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: rev, envelope: envelope("confirmation", randomUUID(), rev + 1) }).expect(200);
      rev++;
    }
    await request(app).put(`/api/v1/requests/${item.id}/confirmation`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: rev, envelope: envelope("confirmation", randomUUID(), rev + 1) }).expect(429);
  });

  it("rejects a report once request reaches 48 reports", async () => {
    const parent = await bill(); const item = await child(parent);
    let rev = 1;
    for (let i = 0; i < 48; i++) {
      await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: rev, envelope: envelope("report", randomUUID(), rev + 1) }).expect(201);
      rev++;
    }
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: rev, envelope: envelope("report", randomUUID(), rev + 1) }).expect(429);
  });
});

describe("delete idempotency and post-delete access", () => {
  it("returns 404 on all routes after a bill is deleted", async () => {
    const parent = await bill(); const item = await child(parent);
    await request(app).delete(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(204);
    // Bill is gone
    await request(app).get(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).expect(404);
    // Request is gone (cascaded)
    await request(app).get(`/api/v1/requests/${item.id}`).set("Authorization", auth(item.read)).expect(404);
    await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send({ operationId: randomUUID(), expectedRevision: 2, envelope: envelope("report", randomUUID(), 3) }).expect(404);
    // Deleting again returns 404 (document gone)
    await request(app).delete(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: randomUUID(), expectedRevision: 1 }).expect(404);
  });
});

describe("error handler: redacted logging", () => {
  it("returns 503 without leaking internal error details for unexpected thrown errors", async () => {
    // Inject a store that throws an unexpected error on bill lookup
    const brokenStore = new RelayStore(client.db("splyt_private_integration"), () => clock);
    vi.spyOn(brokenStore.collection, "findOne").mockRejectedValueOnce(new Error("Internal MongoDB connection reset"));
    const brokenApp = createApp(brokenStore, { webOrigin: "http://localhost:3000", rateLimitMax: 10000 });
    const res = await request(brokenApp).get(`/api/v1/bills/${randomUUID()}`).set("Authorization", auth(randomBytes(32).toString("base64url"))).expect(503);
    // Response must not leak the internal error text
    expect(JSON.stringify(res.body)).not.toContain("MongoDB");
    expect(JSON.stringify(res.body)).not.toContain("connection reset");
    expect(res.body.error).toMatch(/unavailable/i);
  });
});

describe("idempotency replay: scope and fingerprint integrity", () => {
  it("rejects idempotent replay when body fingerprint differs (tampered replay)", async () => {
    const parent = await bill();
    const opId = randomUUID();
    // First write succeeds
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: opId, expectedRevision: 1, envelope: envelope("bill", parent.id, 2) }).expect(200);
    // Replay with same operationId but different envelope (tampered) throws 409
    await request(app).patch(`/api/v1/bills/${parent.id}`).set("Authorization", auth(parent.edit)).send({ operationId: opId, expectedRevision: 1, envelope: envelope("bill", parent.id, 2) }).expect(409);
  });

  it("silently replays when operationId and fingerprint both match", async () => {
    const parent = await bill(); const item = await child(parent);
    const opId = randomUUID();
    const reportEnvelope = envelope("report", randomUUID(), 2);
    const body = { operationId: opId, expectedRevision: 1, envelope: reportEnvelope };
    const first = await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send(body).expect(201);
    const second = await request(app).post(`/api/v1/requests/${item.id}/reports`).set("Authorization", auth(item.report)).send(body).expect(200);
    expect(second.body).toEqual(first.body);
  });
});

describe("rates endpoint hardening", () => {
  it("rejects unknown and syntactically invalid currency codes", async () => {
    await request(app).get("/api/v1/rates?currency=XYZ").expect(400);
    await request(app).get("/api/v1/rates?currency=TOOLONG").expect(400);
    await request(app).get("/api/v1/rates?currency=12").expect(400);
    await request(app).get("/api/v1/rates?currency=").expect(400);
    // Entirely missing query string
    await request(app).get("/api/v1/rates").expect(400);
  });

  it("uses the public live API without an authentication header", async () => {
    let seenKey: string | undefined;
    const fetcher: typeof fetch = async (url, init) => {
      expect(new URL(String(url)).origin).toBe("https://api.coingecko.com");
      seenKey = (init?.headers as Record<string, string> | undefined)?.["x-cg-demo-api-key"];
      return new Response(`{"zcash":{"usd":30,"last_updated_at":${Math.floor(clock / 1000)}}}`);
    };
    const provider = new PublicRates(fetcher, () => clock);
    await provider.get("USD");
    expect(seenKey).toBeUndefined();
  });

  it("deduplicates concurrent fetches for the same currency (pending map)", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (_url) => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return new Response(`{"zcash":{"usd":30,"last_updated_at":${Math.floor(clock / 1000)}}}`);
    };
    const provider = new PublicRates(fetcher, () => clock);
    // Fire two concurrent requests — should produce only one upstream call
    const [a, b] = await Promise.all([provider.get("USD"), provider.get("USD")]);
    expect(calls).toBe(1);
    expect(a.price).toBe(b.price);
  });

  it("serves a stale cached quote and re-fetches after TTL even when upstream timestamp is fresh", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return new Response(`{"zcash":{"usd":${40 + calls},"last_updated_at":${Math.floor(clock / 1000)}}}`);
    };
    const provider = new PublicRates(fetcher, () => clock);
    const first = await provider.get("USD"); expect(calls).toBe(1);
    // Within 60 s — served from cache
    clock += 30000; const cached = await provider.get("USD"); expect(calls).toBe(1); expect(cached.price).toBe(first.price);
    // After 60 s — new fetch
    clock += 31000; const fresh = await provider.get("USD"); expect(calls).toBe(2); expect(fresh.price).not.toBe(first.price);
  });

  it("returns 503 when upstream returns a non-ok HTTP status", async () => {
    const fetcher: typeof fetch = async () => new Response("", { status: 502 });
    const provider = new PublicRates(fetcher, () => clock);
    await expect(provider.get("USD")).rejects.toThrow(/unavailable/i);
  });

  it("returns 503 when upstream response exceeds 10 000 bytes", async () => {
    const fetcher: typeof fetch = async () => new Response("x".repeat(10001));
    const provider = new PublicRates(fetcher, () => clock);
    await expect(provider.get("USD")).rejects.toThrow(/unavailable/i);
  });

  it("returns 503 when upstream price is zero", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(`{"zcash":{"usd":0,"last_updated_at":${Math.floor(clock / 1000)}}}`);
    const provider = new PublicRates(fetcher, () => clock);
    await expect(provider.get("USD")).rejects.toThrow(/unavailable/i);
  });

  it("returns 503 when upstream updated_at is in the future by more than 60 s", async () => {
    const fetcher: typeof fetch = async () =>
      new Response(`{"zcash":{"usd":30,"last_updated_at":${Math.floor((clock + 120000) / 1000)}}}`);
    const provider = new PublicRates(fetcher, () => clock);
    await expect(provider.get("USD")).rejects.toThrow(/unavailable/i);
  });
});

describe("authorised() helper unit tests", () => {
  it("correctly validates a capability against its stored hash", () => {
    const cap = randomBytes(32).toString("base64url");
    const stored = hash(cap);
    expect(authorised(cap, stored)).toBe(true);
  });

  it("returns false for a wrong capability", () => {
    const cap = randomBytes(32).toString("base64url");
    const stored = hash(cap);
    const wrong = randomBytes(32).toString("base64url");
    expect(authorised(wrong, stored)).toBe(false);
  });

  it("returns false for undefined (no Authorization header)", () => {
    const stored = hash(randomBytes(32).toString("base64url"));
    expect(authorised(undefined, stored)).toBe(false);
  });

  it("returns false for a capability that is the right length but not base64url", () => {
    // 43-char string with disallowed characters
    const bad = "!".repeat(43);
    const stored = hash(randomBytes(32).toString("base64url"));
    expect(authorised(bad, stored)).toBe(false);
  });
});

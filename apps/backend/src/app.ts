import express, { type Request, type Response, type NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authorised, checkEnvelope, conflict, envelopeSchema, hash, idSchema, issueCapability, notFound, publicBill, publicRequest, RelayError, RelayStore, remember, replay, RETENTION_MS, type BillRecord } from "./relay.js";
import { PublicRates } from "./rates.js";

const reservation = z.strictObject({ id: idSchema, operationId: idSchema });
const write = z.strictObject({ operationId: idSchema, expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), envelope: envelopeSchema });
const mutation = write.omit({ envelope: true });
const finalise = write.extend({ id: idSchema });
const token = (request: Request) => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization ?? "")?.[1];
const own = (request: Request, bill: BillRecord) => { if (!authorised(token(request), bill.editHash)) throw notFound(); };
const routeId = (request: Request) => String(request.params.id ?? "");

export function createApp(store: RelayStore, options: { webOrigin: string; rates?: PublicRates; rateLimitMax?: number }) {
  const app = express();
  const origin = new URL(options.webOrigin).origin;
  const rates = options.rates ?? new PublicRates();
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    response.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" });
    if (request.headers.origin && request.headers.origin !== origin) return response.status(403).json({ error: "Origin not allowed." });
    response.set({ "Access-Control-Allow-Origin": origin, Vary: "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS" });
    if (request.method === "OPTIONS") return response.sendStatus(204);
    next();
  });
  app.get("/api/health", async (_request, response) => {
    await store.checkHealth();
    response.json({ ok: true, service: "splyt-relay", apiVersion: 1 });
  });
  app.use("/api/v1", rateLimit({ windowMs: 60000, limit: options.rateLimitMax ?? 180, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Try again shortly." } }));
  app.use(express.json({ limit: "600kb", strict: true }));
  app.get("/api/v1/rates", async (request, response) => {
    const query = z.strictObject({ currency: z.string().regex(/^[A-Za-z]{3}$/) }).parse(request.query);
    response.json(await rates.get(query.currency.toUpperCase()));
  });
  const creationLimit = rateLimit({ windowMs: 3600000, limit: options.rateLimitMax ?? 20, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Creation limit reached. Try again later." } });
  app.post("/api/v1/bills", creationLimit, async (request, response) => {
    const body = reservation.parse(request.body);
    const capability = issueCapability();
    const bill: BillRecord = { _id: body.id, editHash: hash(capability), envelope: null, revision: 0, storageRevision: 0, expiresAt: new Date(store.now() + RETENTION_MS), requests: [], writes: [] };
    try { await store.collection.insertOne(bill); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) throw new RelayError(409, "The reservation already exists. If its capability was not saved, start an unshared bill with a new identifier.");
      throw error;
    }
    response.status(201).json({ id: bill._id, editCapability: capability, revision: 0, retainedUntil: bill.expiresAt.toISOString() });
  });
  app.get("/api/v1/bills/:id", async (request, response) => {
    const bill = await store.bill(routeId(request)); own(request, bill);
    response.json(publicBill(bill));
  });
  app.patch("/api/v1/bills/:id", async (request, response) => {
    const bill = await store.bill(routeId(request)); own(request, bill);
    const body = write.parse(request.body);
    const repeated = replay(bill, body.operationId, "manifest", body);
    if (repeated) return response.json(repeated);
    if (body.expectedRevision !== bill.revision) throw conflict();
    checkEnvelope(body.envelope, "bill", bill._id, bill.revision + 1);
    bill.envelope = body.envelope; bill.revision += 1; store.renew(bill);
    const result = { id: bill._id, revision: bill.revision, retainedUntil: bill.expiresAt.toISOString() };
    remember(bill, body.operationId, "manifest", body, result); await store.save(bill);
    response.json(result);
  });
  app.delete("/api/v1/bills/:id", async (request, response) => {
    const bill = await store.bill(routeId(request)); own(request, bill);
    const body = mutation.parse(request.body);
    if (body.expectedRevision !== bill.revision) throw conflict();
    const result = await store.collection.deleteOne({ _id: bill._id, storageRevision: bill.storageRevision });
    if (result.deletedCount !== 1) throw conflict();
    response.sendStatus(204);
  });
  app.post("/api/v1/bills/:id/requests", async (request, response) => {
    const bill = await store.bill(routeId(request)); own(request, bill);
    if (!bill.envelope) throw new RelayError(409, "Save the encrypted organiser manifest before creating requests.");
    if (request.body && "envelope" in request.body) {
      const body = finalise.parse(request.body);
      const repeated = replay(bill, body.operationId, `publish:${body.id}`, body);
      if (repeated) return response.json(repeated);
      const child = bill.requests.find((entry) => entry.id === body.id);
      if (!child) throw notFound();
      if (child.envelope || child.revokedAt || body.expectedRevision !== 0) throw conflict();
      checkEnvelope(body.envelope, "request", child.id, 1);
      child.envelope = body.envelope; child.revision = 1; store.renew(bill);
      const result = { id: child.id, revision: child.revision, retainedUntil: bill.expiresAt.toISOString() };
      remember(bill, body.operationId, `publish:${child.id}`, body, result); await store.save(bill);
      return response.status(201).json(result);
    }
    const body = reservation.parse(request.body);
    const existing = bill.requests.find((entry) => entry.id === body.id);
    if (existing?.envelope || existing?.revokedAt) throw conflict();
    if (!existing && bill.requests.length >= 150) throw new RelayError(413, "This bill has reached its request-history limit.");
    const readCapability = issueCapability(); const reportCapability = issueCapability();
    const child = existing ?? { id: body.id, envelope: null, revision: 0, readHash: "", reportHash: "", revokedAt: null, reports: [], confirmations: [] };
    child.readHash = hash(readCapability); child.reportHash = hash(reportCapability);
    if (!existing) bill.requests.push(child);
    store.renew(bill); await store.save(bill);
    response.status(201).json({ id: child.id, revision: 0, readCapability, reportCapability, retainedUntil: bill.expiresAt.toISOString() });
  });
  app.get("/api/v1/requests/:id", async (request, response) => {
    const { bill, request: child } = await store.request(routeId(request));
    if (child.revokedAt || !authorised(token(request), child.readHash)) throw notFound();
    response.json(publicRequest(child, bill));
  });
  const reportLimit = rateLimit({ windowMs: 300000, limit: options.rateLimitMax ?? 12, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Report limit reached. Wait before submitting another report." } });
  app.post("/api/v1/requests/:id/reports", reportLimit, async (request, response) => {
    const { bill, request: child } = await store.request(routeId(request));
    if (child.revokedAt || !authorised(token(request), child.reportHash)) throw notFound();
    const body = write.parse(request.body);
    const repeated = replay(bill, body.operationId, `report:${child.id}`, body);
    if (repeated) return response.json(repeated);
    if (body.expectedRevision !== child.revision) throw conflict();
    if (child.reports.length >= 48) throw new RelayError(429, "This request has reached its report limit.");
    if (child.reports.some((entry) => entry.id === body.envelope.recordId)) throw conflict();
    checkEnvelope(body.envelope, "report", body.envelope.recordId, child.revision + 1);
    child.revision += 1;
    child.reports.push({ id: body.envelope.recordId, envelope: body.envelope, createdAt: new Date(store.now()).toISOString() });
    const result = { id: child.id, revision: child.revision, retainedUntil: bill.expiresAt.toISOString() };
    remember(bill, body.operationId, `report:${child.id}`, body, result); await store.save(bill);
    response.status(201).json(result);
  });
  app.put("/api/v1/requests/:id/confirmation", async (request, response) => {
    const { bill, request: child } = await store.request(routeId(request)); own(request, bill);
    if (child.revokedAt) throw notFound();
    const body = write.parse(request.body);
    const repeated = replay(bill, body.operationId, `confirmation:${child.id}`, body);
    if (repeated) return response.json(repeated);
    if (body.expectedRevision !== child.revision) throw conflict();
    if (child.confirmations.length >= 64) throw new RelayError(429, "This request has reached its acknowledgement-history limit.");
    if (child.confirmations.some((entry) => entry.id === body.envelope.recordId)) throw conflict();
    checkEnvelope(body.envelope, "confirmation", body.envelope.recordId, child.revision + 1);
    child.revision += 1;
    child.confirmations.push({ id: body.envelope.recordId, envelope: body.envelope, createdAt: new Date(store.now()).toISOString() });
    store.renew(bill);
    const result = { id: child.id, revision: child.revision, retainedUntil: bill.expiresAt.toISOString() };
    remember(bill, body.operationId, `confirmation:${child.id}`, body, result); await store.save(bill);
    response.json(result);
  });
  app.post("/api/v1/requests/:id/revoke", async (request, response) => {
    const { bill, request: child } = await store.request(routeId(request)); own(request, bill);
    const body = mutation.parse(request.body);
    const repeated = replay(bill, body.operationId, `revoke:${child.id}`, body);
    if (repeated) return response.json(repeated);
    if (body.expectedRevision !== child.revision) throw conflict();
    child.revokedAt = new Date(store.now()).toISOString(); child.revision += 1; store.renew(bill);
    const result = { id: child.id, revision: child.revision, retainedUntil: bill.expiresAt.toISOString() };
    remember(bill, body.operationId, `revoke:${child.id}`, body, result); await store.save(bill);
    response.json(result);
  });
  app.use((_request, response) => response.status(404).json({ error: "Record not found." }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "Invalid request shape." });
    if (error instanceof RelayError) return response.status(error.status).json({ error: error.message });
    if (error && typeof error === "object" && "type" in error && error.type === "entity.too.large") return response.status(413).json({ error: "Request too large." });
    if (error instanceof SyntaxError) return response.status(400).json({ error: "Invalid JSON." });
    // Do not log headers, request bodies, database documents or upstream errors.
    response.status(503).json({ error: "The relay is unavailable. Your local records have not been cleared." });
  });
  return app;
}

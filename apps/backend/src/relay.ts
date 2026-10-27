import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { z } from "zod";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const idSchema = z.uuid();
export const envelopeSchema = z.strictObject({
  version: z.literal(1),
  kind: z.enum(["bill", "request", "report", "confirmation"]),
  recordId: idSchema,
  revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  ciphertext: z.string().min(22).max(524288).regex(/^[A-Za-z0-9_-]+$/),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export interface UpdateRecord { id: string; envelope: Envelope; createdAt: string }
export interface RequestRecord {
  id: string;
  envelope: Envelope | null;
  revision: number;
  readHash: string;
  reportHash: string;
  revokedAt: string | null;
  reports: UpdateRecord[];
  confirmations: UpdateRecord[];
}
interface WriteRecord { operationId: string; scope: string; fingerprint: string; response: Record<string, unknown> }
export interface BillRecord {
  _id: string;
  editHash: string;
  envelope: Envelope | null;
  revision: number;
  storageRevision: number;
  expiresAt: Date;
  requests: RequestRecord[];
  writes: WriteRecord[];
}

export class RelayError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const notFound = () => new RelayError(404, "Record not found.");
export const conflict = () => new RelayError(409, "This record changed. Refresh before trying again.");
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const issueCapability = () => randomBytes(32).toString("base64url");
export function authorised(token: string | undefined, storedHash: string): boolean {
  const candidate = /^[A-Za-z0-9_-]{43}$/.test(token ?? "") ? hash(token!) : hash("");
  return timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(storedHash, "hex"));
}
export function checkEnvelope(envelope: Envelope, kind: Envelope["kind"], recordId: string, revision: number): void {
  const maximum = { bill: 524288, request: 32768, report: 4096, confirmation: 8192 }[kind];
  const decoded = Buffer.from(envelope.ciphertext, "base64url");
  if (envelope.kind !== kind || envelope.recordId !== recordId || envelope.revision !== revision || envelope.ciphertext.length > maximum || decoded.length < 16 || decoded.toString("base64url") !== envelope.ciphertext) {
    throw new RelayError(400, "Invalid encrypted envelope or revision.");
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function replay(bill: BillRecord, operationId: string, scope: string, body: unknown): Record<string, unknown> | null {
  const old = bill.writes.find((write) => write.operationId === operationId);
  if (!old) return null;
  if (old.scope !== scope || old.fingerprint !== hash(canonical(body))) throw conflict();
  return old.response;
}
export function remember(bill: BillRecord, operationId: string, scope: string, body: unknown, response: Record<string, unknown>): void {
  if (bill.writes.length >= 4096) throw new RelayError(429, "This bill has reached its write limit. Export it before starting a new bill.");
  bill.writes.push({ operationId, scope, fingerprint: hash(canonical(body)), response });
}
export const publicRequest = (request: RequestRecord, bill: BillRecord) => ({
  id: request.id, envelope: request.envelope, revision: request.revision,
  reports: request.reports, confirmations: request.confirmations,
  revoked: request.revokedAt !== null, retainedUntil: bill.expiresAt.toISOString(),
});
export const publicBill = (bill: BillRecord) => ({
  id: bill._id, envelope: bill.envelope, revision: bill.revision,
  retainedUntil: bill.expiresAt.toISOString(), requests: bill.requests.map((request) => publicRequest(request, bill)),
});

export class RelayStore {
  readonly collection: Collection<BillRecord>;
  constructor(private readonly db: Db, readonly now: () => number = Date.now) { this.collection = db.collection<BillRecord>("private_bills_v1"); }
  async checkHealth(): Promise<void> {
    await this.db.command({ ping: 1 }, { timeoutMS: 5000 });
  }
  async initialise(): Promise<void> {
    await this.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    await this.collection.createIndex({ "requests.id": 1 }, { unique: true, sparse: true });
  }
  async bill(id: string): Promise<BillRecord> {
    if (!idSchema.safeParse(id).success) throw notFound();
    const bill = await this.collection.findOne({ _id: id, expiresAt: { $gt: new Date(this.now()) } });
    if (!bill) throw notFound();
    return bill;
  }
  async request(id: string): Promise<{ bill: BillRecord; request: RequestRecord }> {
    if (!idSchema.safeParse(id).success) throw notFound();
    const bill = await this.collection.findOne({ "requests.id": id, expiresAt: { $gt: new Date(this.now()) } });
    const request = bill?.requests.find((entry) => entry.id === id);
    if (!bill || !request || !request.envelope) throw notFound();
    return { bill, request };
  }
  renew(bill: BillRecord): void { bill.expiresAt = new Date(this.now() + RETENTION_MS); }
  async save(bill: BillRecord): Promise<void> {
    // A single bounded document makes grouping, revision checks and TTL deletion atomic.
    if (Buffer.byteLength(JSON.stringify(bill)) > 8 * 1024 * 1024) throw new RelayError(413, "This bill exceeds the relay storage limit.");
    const previous = bill.storageRevision;
    bill.storageRevision += 1;
    const result = await this.collection.replaceOne({ _id: bill._id, storageRevision: previous, expiresAt: { $gt: new Date(this.now()) } }, bill);
    if (result.modifiedCount !== 1) throw conflict();
  }
}

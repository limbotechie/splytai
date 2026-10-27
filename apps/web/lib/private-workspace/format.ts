export type EnvelopeKind =
  | "bill"
  | "request"
  | "report"
  | "confirmation"
  | "local"
  | "recovery";

export interface EncryptionContext {
  kind: EnvelopeKind;
  recordId: string;
  revision: number;
}

export interface EncryptedEnvelope extends EncryptionContext {
  version: 1;
  nonce: string;
  ciphertext: string;
}

export interface SignedJson<T> {
  payload: T;
  signature: string;
}

export const MAX_JSON_BYTES = 15 * 1024 * 1024;
export const MAX_RECORD_BYTES = 2 * 1024 * 1024;
export const MAX_RECORDS = 5_000;
const MAX_BINARY_BYTES = MAX_JSON_BYTES + 16;
const KINDS: readonly string[] = [
  "bill", "request", "report", "confirmation", "local", "recovery",
];

export function isObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const ownKeys = Reflect.ownKeys(value);
  return ownKeys.length === keys.length && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable === true && "value" in descriptor;
  });
}

export function assertRecordId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) {
    throw new Error("Invalid record ID.");
  }
}

export function assertRevision(revision: unknown, minimum = 0): asserts revision is number {
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < minimum) {
    throw new Error("Invalid record revision.");
  }
}

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const parts: string[] = [];
  let characters = 0;
  let nodes = 0;
  const invalid = () => new Error("Value must be bounded, strict JSON.");
  const append = (part: string) => {
    characters += part.length;
    if (characters > MAX_JSON_BYTES) throw invalid();
    parts.push(part);
  };
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 100_000 || depth > 64) throw invalid();
    if (item === null) return append("null");
    if (typeof item === "string" || typeof item === "boolean") return append(JSON.stringify(item));
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw invalid();
      return append(JSON.stringify(item));
    }
    if (typeof item !== "object" || ancestors.has(item)) throw invalid();
    ancestors.add(item);
    if (Array.isArray(item)) {
      if (Reflect.ownKeys(item).length !== item.length + 1) throw invalid();
      append("[");
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        if (index) append(",");
        visit(descriptor.value, depth + 1);
      }
      append("]");
    } else {
      if (!isObject(item) || Object.getOwnPropertySymbols(item).length) throw invalid();
      // Build the serialization directly: JSON.stringify reorders integer-like object keys.
      const keys = Object.getOwnPropertyNames(item).sort();
      append("{");
      keys.forEach((key, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        if (index) append(",");
        append(JSON.stringify(key));
        append(":");
        visit(descriptor.value, depth + 1);
      });
      append("}");
    }
    ancestors.delete(item);
  };
  visit(value, 0);
  const result = parts.join("");
  if (new TextEncoder().encode(result).byteLength > MAX_JSON_BYTES) throw invalid();
  return result;
}

export function encodeBase64Url(input: Uint8Array | ArrayBuffer): string {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer)) {
    throw new Error("Invalid binary data.");
  }
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > MAX_BINARY_BYTES) throw new Error("Binary data is too large.");
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" || value.length > Math.ceil(MAX_BINARY_BYTES * 4 / 3) ||
    value.length % 4 === 1 || !/^[A-Za-z0-9_-]*$/.test(value)
  ) throw new Error("Invalid base64url data.");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  if (encodeBase64Url(bytes) !== value) throw new Error("Invalid base64url data.");
  return bytes;
}

export function validateContext(value: unknown): EncryptionContext {
  if (!hasExactKeys(value, ["kind", "recordId", "revision"]) || !KINDS.includes(value.kind as string)) {
    throw new Error("Invalid encryption context.");
  }
  assertRecordId(value.recordId);
  assertRevision(value.revision);
  return { kind: value.kind as EnvelopeKind, recordId: value.recordId, revision: value.revision };
}

export function validateEnvelope(value: unknown, expected: EncryptionContext): EncryptedEnvelope {
  const context = validateContext(expected);
  if (
    !hasExactKeys(value, ["version", "kind", "recordId", "revision", "nonce", "ciphertext"]) ||
    value.version !== 1 || value.kind !== context.kind || value.recordId !== context.recordId ||
    value.revision !== context.revision || typeof value.nonce !== "string" || typeof value.ciphertext !== "string"
  ) throw new Error("Invalid encrypted envelope.");
  if (decodeBase64Url(value.nonce).length !== 12 || decodeBase64Url(value.ciphertext).length < 16) {
    throw new Error("Invalid encrypted envelope.");
  }
  return { version: 1, ...context, nonce: value.nonce, ciphertext: value.ciphertext };
}

export function validateLocalRecord(value: unknown): { id: string; revision: number; value: unknown } {
  if (!hasExactKeys(value, ["id", "revision", "value"])) throw new Error("Invalid local record.");
  assertRecordId(value.id);
  assertRevision(value.revision, 1);
  if (new TextEncoder().encode(canonicalJson(value.value)).length > MAX_RECORD_BYTES) {
    throw new Error("Local record is too large.");
  }
  return { id: value.id, revision: value.revision, value: value.value };
}

export function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

import {
  canonicalJson, decodeBase64Url, encodeBase64Url, hasExactKeys, isObject,
  validateContext, validateEnvelope,
  type EncryptedEnvelope, type EncryptionContext, type SignedJson,
} from "./format";

export { canonicalJson, decodeBase64Url, encodeBase64Url } from "./format";
export type { EncryptedEnvelope, EncryptionContext, EnvelopeKind, SignedJson } from "./format";

function browserCrypto(): Crypto {
  if (
    typeof window === "undefined" || window.isSecureContext !== true ||
    typeof window.crypto?.getRandomValues !== "function" || !window.crypto.subtle
  ) throw new Error("This workspace requires a secure browser with WebCrypto support.");
  return window.crypto;
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return typeof CryptoKey !== "undefined" && value instanceof CryptoKey;
}

export function randomId(): string {
  const bytes = browserCrypto().getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function randomSecret(): string {
  return encodeBase64Url(browserCrypto().getRandomValues(new Uint8Array(32)));
}

export async function generateContentKey(): Promise<string> {
  return randomSecret();
}

async function contentKey(key: string | CryptoKey, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const crypto = browserCrypto();
  if (typeof key === "string") {
    const bytes = decodeBase64Url(key);
    if (bytes.length !== 32) throw new Error("Invalid content key.");
    return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM", length: 256 }, false, [usage]);
  }
  if (
    !isCryptoKey(key) || key.type !== "secret" || key.algorithm.name !== "AES-GCM" ||
    (key.algorithm as AesKeyAlgorithm).length !== 256 || !key.usages.includes(usage)
  ) throw new Error("Invalid content key.");
  return key;
}

function additionalData(context: EncryptionContext): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalJson({ version: 1, ...context }));
}

export async function encryptJson(
  key: string | CryptoKey,
  value: unknown,
  context: EncryptionContext,
): Promise<EncryptedEnvelope> {
  const crypto = browserCrypto();
  const bound = validateContext(context);
  const plaintext = new TextEncoder().encode(canonicalJson(value));
  const imported = await contentKey(key, "encrypt");
  // Callers cannot supply or reuse a nonce, including during retries of the same revision.
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: additionalData(bound), tagLength: 128 },
    imported,
    plaintext,
  );
  return { version: 1, ...bound, nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(ciphertext) };
}

export async function decryptJson<T>(
  key: string | CryptoKey,
  envelope: EncryptedEnvelope,
  expectedContext: EncryptionContext,
): Promise<T> {
  const crypto = browserCrypto();
  try {
    const bound = validateContext(expectedContext);
    const checked = validateEnvelope(envelope, bound);
    const imported = await contentKey(key, "decrypt");
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM", iv: decodeBase64Url(checked.nonce),
        additionalData: additionalData(bound), tagLength: 128,
      },
      imported,
      decodeBase64Url(checked.ciphertext),
    );
    const text = new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
    const value: unknown = JSON.parse(text);
    if (canonicalJson(value) !== text) throw new Error("Invalid JSON encoding.");
    return value as T;
  } catch {
    throw new Error("Unable to decrypt this record. Its key, content, or context is invalid.");
  }
}

function signingJwk(value: unknown, usage: "sign" | "verify"): JsonWebKey {
  if (!isObject(value)) throw new Error("Invalid signing key.");
  const allowed = ["kty", "crv", "x", "y", "ext", "key_ops", "alg", "use"];
  if (usage === "sign") allowed.push("d");
  const keys = Object.keys(value);
  if (
    !hasExactKeys(value, keys) || keys.some((key) => !allowed.includes(key)) ||
    value.kty !== "EC" || value.crv !== "P-256" ||
    (value.alg !== undefined && value.alg !== "ES256") ||
    (value.use !== undefined && value.use !== "sig") ||
    (value.ext !== undefined && typeof value.ext !== "boolean") ||
    (value.key_ops !== undefined && (
      !Array.isArray(value.key_ops) || value.key_ops.length !== 1 || value.key_ops[0] !== usage
    ))
  ) throw new Error("Invalid signing key.");
  for (const coordinate of usage === "sign" ? ["x", "y", "d"] : ["x", "y"]) {
    if (typeof value[coordinate] !== "string" || decodeBase64Url(value[coordinate]).length !== 32) {
      throw new Error("Invalid signing key.");
    }
  }
  return JSON.parse(canonicalJson(value)) as JsonWebKey;
}

async function signingKey(key: JsonWebKey | CryptoKey, usage: "sign" | "verify"): Promise<CryptoKey> {
  const crypto = browserCrypto();
  if (isCryptoKey(key)) {
    if (
      key.type !== (usage === "sign" ? "private" : "public") || key.algorithm.name !== "ECDSA" ||
      (key.algorithm as EcKeyAlgorithm).namedCurve !== "P-256" ||
      key.usages.length !== 1 || key.usages[0] !== usage
    ) throw new Error("Invalid signing key.");
    return key;
  }
  return crypto.subtle.importKey(
    "jwk", signingJwk(key, usage), { name: "ECDSA", namedCurve: "P-256" }, false, [usage],
  );
}

export async function generateSigningKeys(): Promise<{ privateKey: JsonWebKey; publicKey: JsonWebKey }> {
  const crypto = browserCrypto();
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const [privateKey, publicKey] = await Promise.all([
    crypto.subtle.exportKey("jwk", pair.privateKey), crypto.subtle.exportKey("jwk", pair.publicKey),
  ]);
  // The caller must retain the private JWK only in encrypted local inventory/recovery records.
  return { privateKey, publicKey };
}

export async function signJson<T>(privateKey: JsonWebKey | CryptoKey, payload: T): Promise<SignedJson<T>> {
  const crypto = browserCrypto();
  const text = canonicalJson(payload);
  const bytes = new TextEncoder().encode(text);
  const jwk = isCryptoKey(privateKey) ? null : signingJwk(privateKey, "sign");
  const key = await signingKey(jwk ?? privateKey, "sign");
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, bytes);
  // WebCrypto uses IEEE-P1363 r || s, not an ASN.1/DER signature.
  if (signature.byteLength !== 64) throw new Error("Invalid ECDSA signature width.");
  if (jwk) {
    const publicKey = await signingKey({ kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, "verify");
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, signature, bytes)) {
      throw new Error("Invalid signing key pair.");
    }
  }
  return { payload: JSON.parse(text) as T, signature: encodeBase64Url(signature) };
}

export async function verifySigned<T>(publicKey: JsonWebKey | CryptoKey, signed: SignedJson<T>): Promise<T> {
  const crypto = browserCrypto();
  try {
    if (!hasExactKeys(signed, ["payload", "signature"]) || typeof signed.signature !== "string") {
      throw new Error("Invalid signed record.");
    }
    const signature = decodeBase64Url(signed.signature);
    if (signature.byteLength !== 64) throw new Error("Invalid ECDSA signature width.");
    const text = canonicalJson(signed.payload);
    const key = await signingKey(publicKey, "verify");
    if (!await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, signature, new TextEncoder().encode(text),
    )) throw new Error("Invalid signature.");
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Unable to verify this signed record.");
  }
}

export async function assertBrowserSupport(): Promise<void> {
  browserCrypto();
  const { workspaceSupport } = await import("./storage");
  if (!await workspaceSupport()) {
    throw new Error("This browser cannot securely store the workspace. Enable IndexedDB storage before creating a bill.");
  }
}

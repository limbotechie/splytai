import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBrowserSupport, canonicalJson, decodeBase64Url, decryptJson, encodeBase64Url,
  encryptJson, generateContentKey, generateSigningKeys, randomId, randomSecret, signJson, verifySigned,
  type EncryptedEnvelope, type EncryptionContext, type SignedJson,
} from "./crypto";
import { installCrypto, nativeCrypto } from "./test-support";

const context: EncryptionContext = { kind: "request", recordId: "request:example", revision: 3 };

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function flipped(value: string, index = 0): string {
  const bytes = decodeBase64Url(value);
  bytes[index] ^= 1;
  return encodeBase64Url(bytes);
}

describe("strict canonical JSON and base64url", () => {
  it("sorts every object lexically, including numeric keys, without reordering arrays", () => {
    expect(canonicalJson({ z: [2, { b: true, a: null }], 2: "two", 10: "ten", a: -0 }))
      .toBe('{"10":"ten","2":"two","a":0,"z":[2,{"a":null,"b":true}]}');
    expect(canonicalJson({ quote: '"\n', text: "\u00e9" })).toBe('{"quote":"\\\"\\n","text":"\u00e9"}');
  });

  it.each([
    undefined, NaN, Infinity, -Infinity, 1n, Symbol("no"), () => 1,
    { missing: undefined }, [undefined], new Array(1), new Date(), new Map(), new Set(),
  ])("rejects non-JSON values: %s", (value) => {
    expect(() => canonicalJson(value)).toThrow("strict JSON");
  });

  it("rejects cycles, excessive depth, symbols, accessors, and hidden properties without invoking getters", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow();
    let deep: unknown = null;
    for (let depth = 0; depth < 66; depth++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow();
    expect(() => canonicalJson({ [Symbol("hidden")]: 1 })).toThrow();
    const getter = vi.fn(() => "secret");
    expect(() => canonicalJson(Object.defineProperty({}, "value", { get: getter, enumerable: true }))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(() => canonicalJson(Object.defineProperty({}, "hidden", { value: 1 }))).toThrow();
    expect(() => canonicalJson(Object.assign([1], { extra: 2 }))).toThrow();
  });

  it("treats __proto__ as JSON data rather than mutating a prototype", () => {
    expect(canonicalJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toBe('{"__proto__":{"polluted":true}}');
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it.each([0, 1, 2, 3, 32, 256, 100_000])("round trips %i binary bytes without padding", (length) => {
    const bytes = Uint8Array.from({ length }, (_, index) => index % 256);
    const encoded = encodeBase64Url(bytes);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
    const decoded = decodeBase64Url(encoded);
    expect(decoded.length).toBe(bytes.length);
    expect(decoded.every((byte, index) => byte === bytes[index])).toBe(true);
  });

  it.each(["A", "AB", "AAB", "AA=", "AA==", "a b", "\nAA", "+w", "/w", "\u00e9"])("rejects noncanonical base64url %s", (value) => {
    expect(() => decodeBase64Url(value)).toThrow();
  });
});

describe("browser boundaries and randomness", () => {
  it("imports all modules during SSR without generating secrets or opening storage", async () => {
    vi.stubGlobal("window", undefined);
    const random = vi.spyOn(nativeCrypto, "getRandomValues");
    const generate = vi.spyOn(nativeCrypto.subtle, "generateKey");
    vi.resetModules();
    await Promise.all([import("./crypto"), import("./storage"), import("./recovery")]);
    expect(random).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(() => randomSecret()).toThrow("secure browser");
    expect(() => randomId()).toThrow("secure browser");
    await expect(generateContentKey()).rejects.toThrow("secure browser");
    await expect(assertBrowserSupport()).rejects.toThrow("secure browser");
  });

  it("refuses insecure contexts and unsupported storage", async () => {
    vi.stubGlobal("window", { ...window, isSecureContext: false });
    expect(() => randomSecret()).toThrow();
    await expect(encryptJson("ignored", {}, context)).rejects.toThrow("secure browser");
    vi.stubGlobal("window", { ...window, isSecureContext: true });
    await expect(assertBrowserSupport()).rejects.toThrow("IndexedDB");
  });

  it("generates independent UUIDv4 IDs and 256-bit secrets", async () => {
    const ids = Array.from({ length: 128 }, () => randomId());
    const secrets = Array.from({ length: 128 }, () => randomSecret());
    expect(new Set(ids).size).toBe(128);
    expect(new Set(secrets).size).toBe(128);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const secret of secrets) expect(decodeBase64Url(secret)).toHaveLength(32);
    expect(decodeBase64Url(await generateContentKey())).toHaveLength(32);
  });
});

describe("AES-256-GCM envelopes", () => {
  it.each(["bill", "request", "report", "confirmation", "local", "recovery"] as const)("round trips the exact %s envelope", async (kind) => {
    const key = await generateContentKey();
    const bound = { ...context, kind };
    const payload = { recipient: "private fixture", amount: "12345", nested: [true, null] };
    const encrypted = await encryptJson(key, payload, bound);
    expect(Object.keys(encrypted).sort()).toEqual(["ciphertext", "kind", "nonce", "recordId", "revision", "version"]);
    expect(decodeBase64Url(encrypted.nonce)).toHaveLength(12);
    expect(decodeBase64Url(encrypted.ciphertext)).toHaveLength(new TextEncoder().encode(canonicalJson(payload)).length + 16);
    expect(JSON.stringify(encrypted)).not.toContain("private fixture");
    await expect(decryptJson(key, encrypted, bound)).resolves.toEqual(payload);
  });

  it("always uses a fresh internal nonce for identical plaintext and revision", async () => {
    const key = randomSecret();
    const envelopes = await Promise.all(Array.from({ length: 256 }, () => encryptJson(key, { same: true }, context)));
    expect(new Set(envelopes.map((envelope) => envelope.nonce)).size).toBe(256);
    expect(new Set(envelopes.map((envelope) => envelope.ciphertext)).size).toBe(256);
  });

  it("uses AES256, tag128, and the canonical version/kind/ID/revision AAD", async () => {
    const spy = vi.spyOn(nativeCrypto.subtle, "encrypt");
    await encryptJson(randomSecret(), {}, context);
    const [algorithm, key] = spy.mock.calls[0];
    expect(key.algorithm).toEqual({ name: "AES-GCM", length: 256 });
    const aes = algorithm as AesGcmParams;
    expect(aes.tagLength).toBe(128);
    expect(new TextDecoder().decode(aes.additionalData)).toBe('{"kind":"request","recordId":"request:example","revision":3,"version":1}');
  });

  it("checks expected context before decrypting and cryptographically binds changed headers", async () => {
    const key = randomSecret();
    const envelope = await encryptJson(key, { destination: "address" }, context);
    const decrypt = vi.spyOn(nativeCrypto.subtle, "decrypt");
    for (const bound of [{ ...context, kind: "bill" as const }, { ...context, recordId: "other" }, { ...context, revision: 4 }]) {
      await expect(decryptJson(key, envelope, bound)).rejects.toThrow("Unable to decrypt");
    }
    expect(decrypt).not.toHaveBeenCalled();
    for (const bound of [{ ...context, kind: "bill" as const }, { ...context, recordId: "other" }, { ...context, revision: 4 }]) {
      await expect(decryptJson(key, { ...envelope, ...bound }, bound)).rejects.toThrow("Unable to decrypt");
    }
    expect(decrypt).toHaveBeenCalledTimes(3);
  });

  it("rejects wrong keys, changed nonce, ciphertext, and authentication tag", async () => {
    const key = randomSecret();
    const envelope = await encryptJson(key, { private: "data" }, context);
    await expect(decryptJson(randomSecret(), envelope, context)).rejects.toThrow("Unable to decrypt");
    for (const changed of [
      { ...envelope, nonce: flipped(envelope.nonce) },
      { ...envelope, ciphertext: flipped(envelope.ciphertext) },
      { ...envelope, ciphertext: flipped(envelope.ciphertext, decodeBase64Url(envelope.ciphertext).length - 1) },
    ]) await expect(decryptJson(key, changed, context)).rejects.toThrow("Unable to decrypt");
  });

  it("rejects malformed envelope shapes without attempting decryption", async () => {
    const key = randomSecret();
    const envelope = await encryptJson(key, {}, context);
    const decrypt = vi.spyOn(nativeCrypto.subtle, "decrypt");
    for (const malformed of [
      null, [], {}, { ...envelope, extra: true }, { ...envelope, version: 2 },
      { ...envelope, revision: "3" }, { ...envelope, revision: -1 }, { ...envelope, nonce: "" },
      { ...envelope, nonce: encodeBase64Url(new Uint8Array(11)) }, { ...envelope, nonce: `${envelope.nonce}=` },
      { ...envelope, ciphertext: encodeBase64Url(new Uint8Array(15)) }, { ...envelope, ciphertext: "not valid" },
    ]) await expect(decryptJson(key, malformed as EncryptedEnvelope, context)).rejects.toThrow("Unable to decrypt");
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("rejects invalid context, raw key width, algorithm, and key usages", async () => {
    for (const bound of [
      { ...context, revision: -1 }, { ...context, revision: 1.5 }, { ...context, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...context, recordId: "" }, { ...context, recordId: "id\n" }, { ...context, extra: true },
    ]) await expect(encryptJson(randomSecret(), {}, bound)).rejects.toThrow();
    await expect(encryptJson(encodeBase64Url(new Uint8Array(16)), {}, context)).rejects.toThrow("content key");
    const short = await nativeCrypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt"]);
    const cbc = await nativeCrypto.subtle.generateKey({ name: "AES-CBC", length: 256 }, false, ["encrypt"]);
    const decryptOnly = await nativeCrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    for (const key of [short, cbc, decryptOnly]) await expect(encryptJson(key, {}, context)).rejects.toThrow("content key");
  });

  it("rejects authenticated but noncanonical, duplicate-key, nonfinite, or invalid UTF-8 JSON", async () => {
    const key = await nativeCrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    for (const plaintext of [new TextEncoder().encode('{"a":1,"a":2}'), new TextEncoder().encode('{ "a": 1 }'), new TextEncoder().encode("1e999"), new Uint8Array([0xff])]) {
      const nonce = nativeCrypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await nativeCrypto.subtle.encrypt({
        name: "AES-GCM", iv: nonce, tagLength: 128,
        additionalData: new TextEncoder().encode(canonicalJson({ version: 1, ...context })),
      }, key, plaintext);
      await expect(decryptJson(key, { version: 1, ...context, nonce: encodeBase64Url(nonce), ciphertext: encodeBase64Url(ciphertext) }, context)).rejects.toThrow("Unable to decrypt");
    }
  });

  it("snapshots caller values and context before asynchronous encryption", async () => {
    const key = randomSecret();
    const payload = { amount: "10" };
    const bound = { ...context };
    const result = encryptJson(key, payload, bound);
    payload.amount = "999";
    bound.revision = 99;
    await expect(decryptJson(key, await result, context)).resolves.toEqual({ amount: "10" });
  });
});

describe("ECDSA P-256 / SHA-256 signed JSON", () => {
  it("exports P256 JWK inventory and uses 64-byte P1363 signatures", async () => {
    const { privateKey, publicKey } = await generateSigningKeys();
    expect(privateKey).toMatchObject({ kty: "EC", crv: "P-256", key_ops: ["sign"] });
    expect(decodeBase64Url(privateKey.d as string)).toHaveLength(32);
    expect(publicKey).toMatchObject({ kty: "EC", crv: "P-256", key_ops: ["verify"] });
    expect(publicKey).not.toHaveProperty("d");
    const payload = { amount: "123", destination: "shielded fixture", revision: 1 };
    const signed = await signJson(privateKey, payload);
    expect(decodeBase64Url(signed.signature)).toHaveLength(64);
    await expect(verifySigned(publicKey, signed)).resolves.toEqual(payload);
    await expect(verifySigned(publicKey, { ...signed, payload: { revision: 1, destination: "shielded fixture", amount: "123" } })).resolves.toEqual(payload);
  });

  it("rejects changed payload, wrong pinned key, signature bits, and malformed signature encoding/width", async () => {
    const keys = await generateSigningKeys();
    const signed = await signJson(keys.privateKey, { destination: "original", amount: "5" });
    await expect(verifySigned((await generateSigningKeys()).publicKey, signed)).rejects.toThrow("Unable to verify");
    for (const changed of [
      { ...signed, payload: { ...signed.payload, destination: "attacker" } },
      { ...signed, payload: { ...signed.payload, amount: "5000" } },
      { ...signed, signature: flipped(signed.signature) }, { ...signed, signature: `${signed.signature}=` },
      { ...signed, signature: encodeBase64Url(new Uint8Array(63)) }, { ...signed, signature: encodeBase64Url(new Uint8Array(65)) },
      { ...signed, signature: encodeBase64Url(new Uint8Array(64)) }, { ...signed, extra: true },
      { payload: signed.payload },
    ]) await expect(verifySigned(keys.publicKey, changed as SignedJson<typeof signed.payload>)).rejects.toThrow("Unable to verify");
  });

  it("rejects invalid JWK types, curves, widths, usages, private keys as public pins, and mismatched pairs", async () => {
    const keys = await generateSigningKeys();
    const signed = await signJson(keys.privateKey, { test: true });
    for (const malformed of [
      { ...keys.publicKey, kty: "RSA" }, { ...keys.publicKey, crv: "P-384" },
      { ...keys.publicKey, x: encodeBase64Url(new Uint8Array(31)) }, { ...keys.publicKey, y: "" },
      { ...keys.publicKey, key_ops: ["sign"] }, { ...keys.publicKey, alg: "HS256" },
      { ...keys.publicKey, use: "enc" }, { ...keys.publicKey, unexpected: true }, keys.privateKey,
    ]) await expect(verifySigned(malformed, signed)).rejects.toThrow("Unable to verify");
    await expect(signJson(keys.publicKey, {})).rejects.toThrow();
    const other = await generateSigningKeys();
    await expect(signJson({ ...keys.privateKey, d: other.privateKey.d }, {})).rejects.toThrow();
    const wrongCurve = await nativeCrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, ["sign", "verify"]);
    await expect(signJson(wrongCurve.privateKey, {})).rejects.toThrow("signing key");
    await expect(verifySigned(wrongCurve.publicKey, signed)).rejects.toThrow("Unable to verify");
  });

  it("supports nonextractable CryptoKeys and returns snapshots rather than mutable caller references", async () => {
    const pair = await nativeCrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const payload = { nested: { amount: "1" } };
    const signing = signJson(pair.privateKey, payload);
    payload.nested.amount = "99";
    const signed = await signing;
    expect(signed.payload).toEqual({ nested: { amount: "1" } });
    const verifying = verifySigned(pair.publicKey, signed);
    signed.payload.nested.amount = "77";
    await expect(verifying).resolves.toEqual({ nested: { amount: "1" } });
  });
});

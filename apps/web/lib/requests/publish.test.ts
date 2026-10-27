import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertRequestSums, isInviteShape, isUnpublished, markCancelled, markPublished, markRevoked,
  prepareRequest, recordReservation, sealRequest, setArchived,
} from "./publish";
import { decryptJson, verifySigned } from "../private-workspace/crypto";
import { installCrypto } from "../private-workspace/test-support";
import { publicKeyFromRaw } from "./payload";
import type { BillManifest } from "../bills/types";
import { validateBillManifest } from "../bills/manifest";
import {
  ALICE, LATER, TESTNET_SAPLING, NOW, ORGANISER, manifestFixture, reservation,
} from "./__tests__/fixtures";

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function publish(): Promise<{
  manifest: BillManifest;
  prepared: Awaited<ReturnType<typeof prepareRequest>>;
  sealed: Awaited<ReturnType<typeof sealRequest>>;
  published: BillManifest;
}> {
  const manifest = await manifestFixture();
  const prepared = await prepareRequest(manifest, ALICE, { now: NOW });
  const reserved = recordReservation(manifest, prepared, reservation(prepared.requestId), NOW);
  const sealed = await sealRequest(reserved, prepared, {
    requestId: prepared.requestId,
    readCapability: reserved.requests[0].readCapability,
    reportCapability: reserved.requests[0].reportCapability,
  });
  const published = markPublished(reserved, prepared.requestId, LATER);
  return { manifest, prepared, sealed, published };
}

describe("request preparation and reservation", () => {
  it("prepares only a private, payable, non-organiser obligation", async () => {
    const manifest = await manifestFixture();
    const prepared = await prepareRequest(manifest, ALICE, { now: NOW });
    expect(prepared.amountZatoshis).toBe("100000000");
    expect(prepared.address).toBe(manifest.receiving.address);
    expect(prepared.network).toBe("testnet");
    expect(prepared.contentKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(prepared.expiresAt).toBe("2026-03-15T10:00:00.000Z");
    expect(prepared.replacementFor).toBeNull();

    await expect(prepareRequest(manifest, ORGANISER)).rejects.toThrow(/no amount to reimburse/);
    await expect(prepareRequest(manifest, "unknown")).rejects.toThrow(/no amount to reimburse/);
  });

  it("refuses a second active request for the same participant until the first is replaced", async () => {
    const { published } = await publish();
    await expect(prepareRequest(published, ALICE, { now: LATER })).rejects.toThrow(/already has an active request/);
  });

  it("records a relay reservation without publishing it", async () => {
    const manifest = await manifestFixture();
    const prepared = await prepareRequest(manifest, ALICE, { now: NOW });
    const reserved = recordReservation(manifest, prepared, reservation(prepared.requestId), NOW);
    expect(reserved.requests).toHaveLength(1);
    expect(isUnpublished(reserved.requests[0])).toBe(true);
    expect(reserved.requests[0].publishedAt).toBeNull();
    expect(() => validateReserved(reserved)).not.toThrow();
  });

  it("rejects dependent capabilities, duplicate reservations and the wrong request", async () => {
    const manifest = await manifestFixture();
    const prepared = await prepareRequest(manifest, ALICE, { now: NOW });
    const issued = reservation(prepared.requestId);
    expect(() => recordReservation(manifest, prepared, {
      ...issued, reportCapability: issued.readCapability,
    }, NOW)).toThrow(/dependent/);
    expect(() => recordReservation(manifest, prepared, { ...issued, requestId: "other" }, NOW)).toThrow(/different request identifier/);
    const reserved = recordReservation(manifest, prepared, issued, NOW);
    expect(() => recordReservation(reserved, prepared, reservation(prepared.requestId), NOW)).toThrow(/already in the manifest/);
  });

  it("replaces a published request while preserving its private obligation", async () => {
    const { published, prepared } = await publish();
    const replacement = await prepareRequest(published, ALICE, { now: LATER, replaceRequestId: prepared.requestId });
    expect(replacement.replacementFor).toBe(prepared.requestId);
    expect(replacement.obligationId).toBe(prepared.obligationId);
    expect(replacement.requestId).not.toBe(prepared.requestId);

    const reserved = recordReservation(published, replacement, reservation(replacement.requestId), LATER);
    const previous = reserved.requests.find((entry) => entry.requestId === prepared.requestId)!;
    const current = reserved.requests.find((entry) => entry.requestId === replacement.requestId)!;
    expect(previous.replacedBy).toBe(replacement.requestId);
    expect(previous.lifecycle).toBe("cancelled");
    expect(current.replacementFor).toBe(prepared.requestId);

    await expect(prepareRequest(reserved, ALICE, { now: LATER, replaceRequestId: prepared.requestId }))
      .rejects.toThrow(/already been replaced/);
  });
});

describe("signing, sealing and publication", () => {
  it("signs the immutable offer and encrypts it with the request's own key", async () => {
    const { prepared, sealed } = await publish();
    expect(sealed.envelope).toMatchObject({ kind: "request", recordId: prepared.requestId, revision: 1 });
    expect(sealed.invite.contentKey).toBe(prepared.contentKey);
    expect(sealed.invite.requestId).toBe(prepared.requestId);
    expect(isInviteShape(sealed.invite)).toBe(true);

    const decrypted = await decryptJson<unknown>(prepared.contentKey, sealed.envelope, {
      kind: "request", recordId: prepared.requestId, revision: 1,
    });
    const payload = await verifySigned<Record<string, unknown>>(publicKeyFromRaw(sealed.invite.publicKey), decrypted as never);
    expect(payload.requestId).toBe(prepared.requestId);
    expect(payload.amountZatoshis).toBe("100000000");
    expect(payload.address).toBe(TESTNET_SAPLING);
    expect((payload.receipt as Record<string, unknown>).shareMinor).toBe("450");
    expect(payload.disclosure).toBe("share-with-items");
  });

  it("detects a swapped signing key, a changed amount and a wrong invitation shape", async () => {
    const { manifest, prepared, sealed } = await publish();
    expect(() => publicKeyFromRaw(sealed.invite.publicKey.slice(0, -1))).toThrow(/pinned signing key/);

    const other = await manifestFixture("22222222-2222-4222-8222-222222222222");
    const decrypted = await decryptJson<unknown>(prepared.contentKey, sealed.envelope, {
      kind: "request", recordId: prepared.requestId, revision: 1,
    });
    const signed = decrypted as { payload: Record<string, unknown>; signature: string };
    await expect(verifySigned(publicKeyFromRaw(sealed.invite.publicKey), {
      payload: { ...signed.payload, amountZatoshis: "1" }, signature: signed.signature,
    })).rejects.toThrow(/Unable to verify/);

    expect(isInviteShape({ ...sealed.invite, contentKey: undefined })).toBe(false);
    expect(isInviteShape({ ...sealed.invite, reportCapability: sealed.invite.readCapability })).toBe(false);
    expect(isInviteShape({ ...sealed.invite, publicKey: manifest.signing.privateKey })).toBe(false);
    expect(other.billId).not.toBe(manifest.billId);
  });

  it("seals only while the manifest is active and the amount is unchanged", async () => {
    const { published, prepared } = await publish();
    const archived = setArchived(published, true, LATER);
    await expect(sealRequest(archived, prepared, {
      requestId: prepared.requestId,
      readCapability: published.requests[0].readCapability,
      reportCapability: published.requests[0].reportCapability,
    })).rejects.toThrow(/Archived bills/);
  });

  it("marks publication once, revokes once and refuses invalid transitions", async () => {
    const { published, prepared } = await publish();
    expect(published.requests[0].publishedAt).toBe(LATER);
    expect(() => markPublished(published, prepared.requestId, NOW)).toThrow(/cannot be published/);

    const revoked = markRevoked(published, prepared.requestId, LATER);
    expect(revoked.requests[0].lifecycle).toBe("revoked");
    expect(revoked.requests[0].revokedAt).toBe(LATER);
    expect(() => markRevoked(revoked, prepared.requestId, LATER)).toThrow(/cannot be revoked/);
    expect(() => markCancelled(revoked, prepared.requestId, LATER)).toThrow(/cannot be cancelled/);

    const cancelled = markCancelled(published, prepared.requestId, LATER);
    expect(cancelled.requests[0].lifecycle).toBe("cancelled");
    expect(cancelled.requests[0].revokedAt).toBeNull();
  });

  it("archives with outstanding requests and restores without changing amounts", async () => {
    const { published } = await publish();
    assertRequestSums(published);
    const archived = setArchived(published, true, LATER);
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt).toBe(LATER);
    expect(archived.allocations).toEqual(published.allocations);
    const restored = setArchived(archived, false, LATER);
    expect(restored.status).toBe("active");
    expect(restored.archivedAt).toBeNull();
    expect(setArchived(restored, false, LATER)).toEqual(restored);
  });
});

function validateReserved(value: BillManifest): void {
  validateBillManifest(value);
}

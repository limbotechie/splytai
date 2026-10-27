import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyLocalUpdate, buildConfirmationUpdate, buildReportUpdate, decryptRequestEnvelope,
  mergeRemoteBill, mergeRequestUpdates, openParticipantRequest, reconcileBill, tracking,
  type EncryptedUpdate,
} from "./sync";
import { markPublished, prepareRequest, recordReservation, sealRequest } from "./publish";
import {
  decryptJson, encodeBase64Url, encryptJson, generateContentKey, type SignedJson,
} from "../private-workspace/crypto";
import { canonicalJson } from "../private-workspace/format";
import { installCrypto } from "../private-workspace/test-support";
import type { ConfirmationPayload, RequestState } from "./types";
import type { RelayBill, RelayRequest } from "./relay";
import type { LocalBill } from "../bills/types";
import {
  ALICE, LATER, NOW, manifestFixture, reservation, snapshot,
} from "./__tests__/fixtures";

const RETENTION = "2026-04-01T10:00:00.000Z";

beforeEach(() => installCrypto());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function flow() {
  const manifest = await manifestFixture();
  const prepared = await prepareRequest(manifest, ALICE, { now: NOW });
  const issued = reservation(prepared.requestId);
  const reserved = recordReservation(manifest, prepared, issued, NOW);
  const sealed = await sealRequest(reserved, prepared, issued);
  const published = markPublished(reserved, prepared.requestId, NOW);
  const bill: LocalBill = {
    version: 1, contentKey: await generateContentKey(), revision: 1,
    retainedUntil: RETENTION, manifest: published,
  };
  const request: RelayRequest = {
    id: prepared.requestId, envelope: sealed.envelope, revision: 1,
    reports: [], confirmations: [], revoked: false, retainedUntil: RETENTION,
  };
  const billRecord: RelayBill = {
    id: published.billId,
    envelope: await encryptJson(bill.contentKey, published, { kind: "bill", recordId: published.billId, revision: 1 }),
    revision: 1, retainedUntil: RETENTION, requests: [request],
  };
  const participant = await openParticipantRequest(sealed.invite, request, NOW);
  return { manifest, prepared, sealed, published, bill, request, billRecord, participant };
}

function relay(record: RelayBill, requests: RelayRequest[]): RelayBill {
  return { ...record, requests };
}

describe("participant entry and request binding", () => {
  it("opens a published request and pins the organiser key and content key", async () => {
    const { participant, prepared, sealed, published } = await flow();
    expect(participant.requestId).toBe(prepared.requestId);
    expect(participant.role).toBe("participant");
    expect(participant.billId).toBeNull();
    expect(participant.contentKey).toBe(sealed.invite.contentKey);
    expect(participant.pinnedPublicKey).toBe(sealed.invite.publicKey);
    expect(participant.payload.payload.amountZatoshis).toBe("100000000");
    expect(participant.lifecycle).toBe("active");
    expect(participant.revision).toBe(1);
    expect(published.requests[0].publishedAt).toBe(NOW);
  });

  it("refuses unpublished, foreign and tampered request envelopes", async () => {
    const { sealed, prepared } = await flow();
    await expect(openParticipantRequest(sealed.invite, {
      id: prepared.requestId, envelope: null, revision: 0,
      reports: [], confirmations: [], revoked: false, retainedUntil: RETENTION,
    })).rejects.toThrow(/not published/);

    const foreign = snapshot(sealed.invite);
    foreign.requestId = "22222222-2222-4222-8222-222222222222";
    await expect(openParticipantRequest(foreign, {
      id: foreign.requestId, envelope: sealed.envelope, revision: 1,
      reports: [], confirmations: [], revoked: false, retainedUntil: RETENTION,
    })).rejects.toThrow(/Unable to decrypt/);

    const tampered = snapshot(sealed.envelope);
    tampered.ciphertext = `${tampered.ciphertext[0] === "A" ? "B" : "A"}${tampered.ciphertext.slice(1)}`;
    await expect(openParticipantRequest(sealed.invite, {
      id: prepared.requestId, envelope: tampered, revision: 1,
      reports: [], confirmations: [], revoked: false, retainedUntil: RETENTION,
    })).rejects.toThrow(/Unable to decrypt/);
  });

  it("rejects a request envelope opened with the wrong key or context", async () => {
    const { prepared, sealed } = await flow();
    await expect(decryptRequestEnvelope(sealed.envelope, await generateContentKey(), sealed.invite.publicKey, {
      requestId: prepared.requestId, obligationId: prepared.obligationId, reference: prepared.reference,
      amountZatoshis: prepared.amountZatoshis, address: prepared.address, network: prepared.network,
    })).rejects.toThrow(/Unable to decrypt/);

    await expect(decryptRequestEnvelope(sealed.envelope, prepared.contentKey, sealed.invite.publicKey, {
      requestId: "33333333-3333-4333-8333-333333333333", obligationId: prepared.obligationId,
      reference: prepared.reference, amountZatoshis: prepared.amountZatoshis,
      address: prepared.address, network: prepared.network,
    })).rejects.toThrow(/Unable to decrypt/);
  });
});

describe("report, confirm and reconcile", () => {
  it("keeps a participant report separate from an organiser confirmation", async () => {
    const { participant, prepared, bill, billRecord, request } = await flow();
    const report = await buildReportUpdate(participant, { claimedZatoshis: "60000000", reference: "tx-1", now: LATER });
    expect(report.expectedRevision).toBe(1);
    expect(report.envelope).toMatchObject({ kind: "report", recordId: report.updateId, revision: 2 });
    const withReport = await applyLocalUpdate(participant, report, LATER);
    expect(withReport.revision).toBe(2);
    expect(tracking(withReport)).toBe("payment_reported");

    const reportedRequest: RelayRequest = {
      ...request, revision: 2, reports: [{ id: report.updateId, envelope: report.envelope, createdAt: LATER }],
    };
    const reconciled = await reconcileBill(bill, relay(billRecord, [reportedRequest]), [], NOW);
    expect(reconciled.missingRequestIds).toEqual([]);
    const organiser = reconciled.requests[0];
    expect(organiser.role).toBe("organiser");
    expect(organiser.billId).toBe(bill.manifest.billId);
    expect(tracking(organiser)).toBe("payment_reported");
    expect(organiser.reports[0].payload.claimedZatoshis).toBe("60000000");

    const confirmation = await buildConfirmationUpdate(organiser, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "60000000", outcome: "partially_confirmed", now: LATER,
    });
    const afterPartial = await applyLocalUpdate(organiser, confirmation, LATER);
    expect(afterPartial.revision).toBe(3);
    expect(tracking(afterPartial)).toBe("partially_confirmed");

    const remotePartial: RelayRequest = {
      ...reportedRequest, revision: 3,
      confirmations: [{ id: confirmation.updateId, envelope: confirmation.envelope, createdAt: LATER }],
    };
    const seen = await mergeRequestUpdates(withReport, remotePartial, LATER);
    expect(tracking(seen)).toBe("partially_confirmed");
    expect(seen.revision).toBe(3);
    expect(seen.confirmations).toHaveLength(1);

    const full = await buildConfirmationUpdate(afterPartial, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "100000000", outcome: "confirmed_by_organiser", now: "2026-03-01T10:20:00.000Z",
    });
    const remoteFull: RelayRequest = {
      ...remotePartial, revision: 4,
      confirmations: [...remotePartial.confirmations, { id: full.updateId, envelope: full.envelope, createdAt: "2026-03-01T10:20:00.000Z" }],
    };
    const confirmed = await mergeRequestUpdates(seen, remoteFull, "2026-03-01T10:21:00.000Z");
    expect(tracking(confirmed)).toBe("confirmed_by_organiser");
    expect(confirmed.confirmations).toHaveLength(2);
    expect(confirmed.revision).toBe(4);
    expect(prepared.requestId).toBe(confirmed.requestId);
  });

  it("records a signed correction with its reason and keeps the history", async () => {
    const { participant, bill, billRecord, request } = await flow();
    const report = await buildReportUpdate(participant, { claimedZatoshis: "100000000", now: LATER });
    const reportedRequest: RelayRequest = { ...request, revision: 2, reports: [{ id: report.updateId, envelope: report.envelope, createdAt: LATER }] };
    const organiser = (await reconcileBill(bill, relay(billRecord, [reportedRequest]), [], NOW)).requests[0];

    const first = await buildConfirmationUpdate(organiser, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "100000000", outcome: "confirmed_by_organiser", now: LATER,
    });
    const afterFirst = await applyLocalUpdate(organiser, first, LATER);
    await expect(buildConfirmationUpdate(afterFirst, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "0", outcome: "correction", correctionReason: "Wrong transfer",
      previousConfirmationId: "44444444-4444-4444-8444-444444444444",
    })).rejects.toThrow(/stored for this request/);

    const correction = await buildConfirmationUpdate(afterFirst, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "0", outcome: "correction", correctionReason: "Wrong transfer",
      previousConfirmationId: first.updateId, now: "2026-03-01T10:30:00.000Z",
    });
    const afterCorrection = await applyLocalUpdate(afterFirst, correction, "2026-03-01T10:30:00.000Z");
    expect(afterCorrection.revision).toBe(4);
    expect(tracking(afterCorrection)).toBe("unpaid");
    expect(afterCorrection.confirmations).toHaveLength(2);
    expect(preserved(afterCorrection)).toBe(1);
  });

  it("blocks reports from an organiser copy and confirmations from a participant copy", async () => {
    const { participant, bill, billRecord, request } = await flow();
    const organiser = (await reconcileBill(bill, relay(billRecord, [request]), [], NOW)).requests[0];
    await expect(buildReportUpdate(organiser, { claimedZatoshis: "1" })).rejects.toThrow(/Only a participant/);
    await expect(buildConfirmationUpdate(participant, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "1", outcome: "partially_confirmed",
    })).rejects.toThrow(/Only the organiser/);
  });
});

function preserved(state: RequestState): number {
  return state.confirmations.filter((record) => record.payload.outcome === "confirmed_by_organiser").length;
}

describe("update storage guards", () => {
  it("stores the authenticated envelope and enforces its revision", async () => {
    const { participant } = await flow();
    const report = await buildReportUpdate(participant, { claimedZatoshis: "1", now: LATER });
    await expect(applyLocalUpdate(participant, { ...report, expectedRevision: 0 }, LATER))
      .rejects.toThrow(/changed in another tab/);
    await expect(applyLocalUpdate(participant, {
      ...report, envelope: { ...report.envelope, kind: "confirmation" },
    }, LATER)).rejects.toThrow(/wrong type/);
    await expect(applyLocalUpdate(participant, {
      ...report, envelope: { ...report.envelope, recordId: "44444444-4444-4444-8444-444444444444" },
    }, LATER)).rejects.toThrow(/wrong record identifier/);
    await expect(applyLocalUpdate(participant, {
      ...report, envelope: { ...report.envelope, revision: 9 },
    }, LATER)).rejects.toThrow(/wrong revision/);
    await expect(applyLocalUpdate(participant, {
      ...report, payload: { ...report.payload, claimedZatoshis: "2" },
    }, LATER)).rejects.toThrow(/does not match its encrypted record/);
    await expect(applyLocalUpdate(participant, {
      ...report, updateId: "not-a-uuid",
    }, LATER)).rejects.toThrow(/identifier is invalid/);

    const stored = await applyLocalUpdate(participant, report, LATER);
    const duplicateState = snapshot({ ...participant, reports: stored.reports }) as RequestState;
    await expect(applyLocalUpdate(duplicateState, report, LATER)).rejects.toThrow(/already present/);
  });

  it("rejects duplicate or substituted remote updates", async () => {
    const { participant, request } = await flow();
    const report = await buildReportUpdate(participant, { claimedZatoshis: "1", now: LATER });
    const withReport = await applyLocalUpdate(participant, report, LATER);
    const base: RelayRequest = {
      ...request, revision: 2,
      reports: [{ id: report.updateId, envelope: report.envelope, createdAt: LATER }],
    };
    const same = await mergeRequestUpdates(withReport, base, LATER);
    expect(same.reports).toHaveLength(1);
    expect(canonicalJson(same.reports)).toBe(canonicalJson(withReport.reports));

    const substituted = snapshot(report.envelope);
    substituted.nonce = encodeBase64Url(new Uint8Array(12));
    await expect(mergeRequestUpdates(withReport, {
      ...base, reports: [{ id: report.updateId, envelope: substituted, createdAt: LATER }],
    }, LATER)).rejects.toThrow(/replaced with different content/);

    const second = await buildReportUpdate(withReport, { claimedZatoshis: "2", now: "2026-03-01T10:10:00.000Z" });
    await expect(mergeRequestUpdates(withReport, {
      ...base, revision: 3,
      reports: [...base.reports, { id: second.updateId, envelope: second.envelope, createdAt: "not a time" }],
    }, LATER)).rejects.toThrow(/invalid update time/);
  });

  it("ignores older revisions and rejects an unauthenticated update time", async () => {
    const { participant, request } = await flow();
    const older = await mergeRequestUpdates(participant, { ...request, revision: 0 }, LATER);
    expect(older.revision).toBe(1);
    expect(older.lastSyncedAt).toBe(NOW);
    await expect(mergeRequestUpdates(participant, request, "yesterday")).rejects.toThrow(/sync time/);
  });

  it("refuses a confirmation whose signature does not verify", async () => {
    const { participant, bill, billRecord, request } = await flow();
    const organiser = (await reconcileBill(bill, relay(billRecord, [request]), [], NOW)).requests[0];
    const confirmation = await buildConfirmationUpdate(organiser, bill.manifest.signing.privateKey, {
      receivedTotalZatoshis: "1", outcome: "partially_confirmed", now: LATER,
    });
    const signed = await decryptJson<SignedJson<ConfirmationPayload>>(participant.contentKey, confirmation.envelope, {
      kind: "confirmation", recordId: confirmation.updateId, revision: 2,
    });
    const forgerId = "55555555-5555-4555-8555-555555555555";
    const forged = await encryptJson(participant.contentKey, {
      payload: signed.payload, signature: encodeBase64Url(new Uint8Array(64)),
    }, { kind: "confirmation", recordId: forgerId, revision: 2 });
    await expect(mergeRequestUpdates(participant, {
      ...request, revision: 2,
      confirmations: [{ id: forgerId, envelope: forged, createdAt: LATER }],
    }, LATER)).rejects.toThrow(/Unable to verify/);
  });
});

describe("organiser bill reconciliation", () => {
  it("never lowers a local revision", async () => {
    const { bill, billRecord } = await flow();
    const ahead = { ...snapshot(bill), revision: 3 };
    const merged = await mergeRemoteBill(ahead, billRecord);
    expect(merged.revision).toBe(3);
    expect(canonicalJson(merged)).toBe(canonicalJson(ahead));
  });

  it("treats an equal-revision mismatch as tampering", async () => {
    const { bill, billRecord } = await flow();
    const changed = snapshot(bill.manifest);
    changed.title = "Replaced";
    changed.receipt.title = "Replaced";
    const forgedEnvelope = await encryptJson(bill.contentKey, changed, {
      kind: "bill", recordId: changed.billId, revision: 1,
    });
    await expect(mergeRemoteBill(bill, { ...billRecord, envelope: forgedEnvelope }))
      .rejects.toThrow(/differs from this browser/);
  });

  it("accepts an equal revision only when the decrypted manifest matches", async () => {
    const { bill, billRecord } = await flow();
    const merged = await mergeRemoteBill(bill, { ...billRecord, retainedUntil: "2026-05-01T10:00:00.000Z" });
    expect(merged.retainedUntil).toBe("2026-05-01T10:00:00.000Z");
    expect(canonicalJson(merged.manifest)).toBe(canonicalJson(bill.manifest));
  });

  it("rejects another bill identifier and a missing manifest", async () => {
    const { bill, billRecord } = await flow();
    await expect(mergeRemoteBill(bill, { ...billRecord, id: "66666666-6666-4666-8666-666666666666" }))
      .rejects.toThrow(/another bill/);
    await expect(mergeRemoteBill(bill, { ...billRecord, envelope: null }))
      .rejects.toThrow(/missing its encrypted manifest/);
  });

  it("merges a newer manifest while keeping a locally reserved request", async () => {
    const base = await manifestFixture();
    const prepared = await prepareRequest(base, ALICE, { now: NOW });
    const issued = reservation(prepared.requestId);
    const localManifest = recordReservation(base, prepared, issued, NOW);
    const contentKey = await generateContentKey();
    const local: LocalBill = { version: 1, contentKey, revision: 1, retainedUntil: RETENTION, manifest: localManifest };
    const remote: RelayBill = {
      id: base.billId,
      envelope: await encryptJson(contentKey, base, { kind: "bill", recordId: base.billId, revision: 2 }),
      revision: 2, retainedUntil: RETENTION, requests: [],
    };
    const merged = await mergeRemoteBill(local, remote);
    expect(merged.revision).toBe(2);
    expect(merged.manifest.billId).toBe(base.billId);
    expect(merged.manifest.requests.map((entry) => entry.requestId)).toEqual([prepared.requestId]);
    expect(merged.manifest.updatedAt).toBe(localManifest.updatedAt);
  });

  it("reports requests the relay no longer retains and rejects unknown ones", async () => {
    const { bill, billRecord, request } = await flow();
    const missing = await reconcileBill(bill, relay(billRecord, []), [], NOW);
    expect(missing.missingRequestIds).toEqual([request.id]);
    expect(missing.requests).toEqual([]);

    const unknownId = "77777777-7777-4777-8777-777777777777";
    await expect(reconcileBill(bill, relay(billRecord, [{ ...request, id: unknownId }]), [], NOW))
      .rejects.toThrow(/missing from the bill manifest/);
  });

  it("refuses a participant copy or a divergent stored request", async () => {
    const { bill, billRecord, participant } = await flow();
    await expect(reconcileBill(bill, billRecord, [participant], NOW)).rejects.toThrow(/participant copy/);

    const organiser = (await reconcileBill(bill, billRecord, [], NOW)).requests[0];
    const divergent: RequestState = {
      ...organiser,
      payload: { payload: { ...organiser.payload.payload, amountZatoshis: "1" }, signature: organiser.payload.signature },
    };
    await expect(reconcileBill(bill, billRecord, [divergent], NOW)).rejects.toThrow(/does not match the relay/);
  });
});

describe("local-only update construction", () => {
  it("rejects invalid update identities before touching state", async () => {
    const { participant } = await flow();
    const report = await buildReportUpdate(participant, { claimedZatoshis: "1", now: LATER });
    const corrupt: EncryptedUpdate & { payload: typeof report.payload } = { ...report, operationId: "nope" };
    await expect(applyLocalUpdate(participant, corrupt, LATER)).rejects.toThrow(/identifier is invalid/);
  });

  it("refuses a bill whose local revision was corrupted", async () => {
    const { bill, billRecord } = await flow();
    await expect(mergeRemoteBill({ ...bill, revision: -1 }, billRecord))
      .rejects.toThrow(/local bill revision is invalid/);
  });
});

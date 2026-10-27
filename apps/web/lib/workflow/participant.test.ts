import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCrypto } from "../private-workspace/test-support";
import {
  captureAndStoreInvite,
  readParticipantInvite,
  openParticipantRequest,
  syncParticipantRequest,
  submitPaymentReport,
  participantPaymentUri,
  clearParticipantRequest,
} from "./participant";
import { createBill, listLocalBills, syncBill } from "./bill";
import { publishRequest, confirmPayment, listLocalRequests, readLocalRequest, syncBillRequests } from "./request";
import { InMemoryRelayClient } from "./__tests__/relay";
import { ALICE, MAINNET_SAPLING, TESTNET_SAPLING, NOW, LATER, EVEN_LATER, receipt, participants } from "../requests/__tests__/fixtures";
import type { RelayClient } from "../requests/relay";

vi.mock("@elemental-zcash/zaddr_wasm_parser", async () => {
  const { loadAddressParser } = await import("../zcash/__tests__/parser");
  return loadAddressParser();
});

let organiserProfile: IDBFactory;
let participantProfile: IDBFactory;

function selectProfile(profile: IDBFactory, url = "https://splyt.example.com/app") {
  installCrypto(profile);
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
  Object.assign(window, { location: new URL(url), history: { state: null, replaceState: vi.fn() } });
}

beforeEach(() => {
  organiserProfile = new IDBFactory();
  participantProfile = new IDBFactory();
  selectProfile(organiserProfile);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("participant workflow", () => {
  async function setupPublishedInvite() {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Dinner",
      receipt: receipt(),
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "200000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 14,
    };
    await createBill(relay, input, NOW);
    let billRecord = (await listLocalBills())[0];
    await syncBill(relay, billRecord, NOW);
    billRecord = (await listLocalBills())[0];

    const appUrl = "https://splyt.example.com";
    const published = await publishRequest(relay, billRecord, ALICE, appUrl, { now: NOW });
    selectProfile(participantProfile, published.inviteUrl);
    return { relay, published };
  }

  it("captures invite from URL and stores it", async () => {
    const { published } = await setupPublishedInvite();
    const invite = await captureAndStoreInvite(published.inviteUrl);

    expect(invite.requestId).toBe(published.invite.requestId);
    expect(invite.readCapability).toBe(published.invite.readCapability);
    expect(invite.contentKey).toBe(published.invite.contentKey);

    const stored = await readParticipantInvite(invite.requestId);
    expect(stored).not.toBeNull();
    expect(stored?.requestId).toBe(invite.requestId);
    expect(window.history.replaceState).toHaveBeenCalledWith(null, "", published.inviteUrl.split("#")[0]);
  });

  it("opens participant request from relay and decrypts payload", async () => {
    const { relay, published } = await setupPublishedInvite();
    const state = await openParticipantRequest(relay, published.invite, NOW);

    expect(state.role).toBe("participant");
    expect(state.requestId).toBe(published.invite.requestId);
    expect(state.payload.payload.participantLabel).toBe("Alice");
    expect(state.payload.payload.amountZatoshis).toBe("100000000");
    expect(state.reports).toHaveLength(0);
    expect(state.confirmations).toHaveLength(0);
  });

  it("generates a valid ZIP 321 payment URI", async () => {
    const { relay, published } = await setupPublishedInvite();
    const state = await openParticipantRequest(relay, published.invite, NOW);

    const uri = await participantPaymentUri(state.payload.payload);
    expect(uri).toMatch(/^zcash:ztestsapling1/);
    expect(uri).toContain("amount=");
    expect(uri).toContain("memo=");
  });

  it("submits payment report and syncs organiser confirmation", async () => {
    const { relay, published } = await setupPublishedInvite();

    // 1. Participant opens request
    const pState = await openParticipantRequest(relay, published.invite, NOW);

    // 2. Participant reports payment
    const reportedState = await submitPaymentReport(relay, pState.requestId, {
      claimedZatoshis: "100000000",
      note: "Paid in tx abc",
      now: LATER,
    });
    expect(reportedState.reports).toHaveLength(1);
    expect(reportedState.reports[0].payload.claimedZatoshis).toBe("100000000");
    expect(reportedState.confirmations).toHaveLength(0);

    // 3. Organiser confirms payment on their side
    selectProfile(organiserProfile);
    await syncBillRequests(relay, (await listLocalBills())[0], (await listLocalRequests()).map((record) => record.value), EVEN_LATER);
    const billRecord = (await listLocalBills())[0];
    const organiserReqRecord = (await listLocalRequests()).find((r) => r.value.role === "organiser")!;

    await confirmPayment(relay, billRecord, organiserReqRecord, {
      receivedTotalZatoshis: "100000000",
      outcome: "confirmed_by_organiser",
      note: "Received",
      now: EVEN_LATER,
    });

    // 4. Participant syncs from relay
    selectProfile(participantProfile);
    const syncedState = await syncParticipantRequest(relay, pState.requestId, EVEN_LATER);
    expect(syncedState.confirmations).toHaveLength(1);
    expect(syncedState.confirmations[0].payload.outcome).toBe("confirmed_by_organiser");
  });

  it("clears participant request locally", async () => {
    const { relay, published } = await setupPublishedInvite();
    const pState = await openParticipantRequest(relay, published.invite, NOW);

    await clearParticipantRequest(pState.requestId);
    const invite = await readParticipantInvite(pState.requestId);
    expect(invite).toBeNull();
  });

  it("validates the real address and limits partial handoff amounts without altering the offer", async () => {
    const { published } = await setupPublishedInvite();
    const payload = published.state.payload.payload;
    await expect(participantPaymentUri(payload, "40000000")).resolves.toContain("amount=0.40000000");
    expect(payload.amountZatoshis).toBe("100000000");
    await expect(participantPaymentUri(payload, "100000001")).rejects.toThrow(/exceed/);
    await expect(participantPaymentUri({ ...payload, network: "mainnet", address: MAINNET_SAPLING })).rejects.toThrow(/testnet/);
    await expect(participantPaymentUri({ ...payload, address: MAINNET_SAPLING })).rejects.toThrow(/testnet/);
    await expect(participantPaymentUri({ ...payload, address: `${TESTNET_SAPLING.slice(0, -1)}q` })).rejects.toThrow(/checksum/);
  });

  it("does not overwrite an organiser record when its invitation is opened in the same profile", async () => {
    const { relay, published } = await setupPublishedInvite();
    selectProfile(organiserProfile);
    await expect(openParticipantRequest(relay, published.invite, NOW)).rejects.toThrow(/separate browser profile/);
    expect((await readLocalRequest(published.invite.requestId))?.value.role).toBe("organiser");
  });

  it("does not erase trusted history by reopening after a relay rollback", async () => {
    const { relay, published } = await setupPublishedInvite();
    const state = await openParticipantRequest(relay, published.invite, NOW);
    await submitPaymentReport(relay, state.requestId, { claimedZatoshis: "1", now: LATER });
    const remote = (relay as unknown as InMemoryRelayClient).requests.get(state.requestId)!;
    remote.reports = [];
    await expect(openParticipantRequest(relay, published.invite, EVEN_LATER)).rejects.toThrow();
    expect((await readLocalRequest(state.requestId))?.value.reports).toHaveLength(1);
  });
});

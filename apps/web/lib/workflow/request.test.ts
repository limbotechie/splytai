import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCrypto } from "../private-workspace/test-support";
import {
  publishRequest,
  syncBillRequests,
  confirmPayment,
  revokePublishedRequest,
  readLocalRequest,
  listLocalRequests,
} from "./request";
import { createBill, listLocalBills, syncBill } from "./bill";
import { InMemoryRelayClient } from "./__tests__/relay";
import { ALICE, TESTNET_SAPLING, NOW, LATER, receipt, participants } from "../requests/__tests__/fixtures";
import type { RelayClient } from "../requests/relay";
import type { RequestInventoryEntry } from "../bills/types";

vi.mock("@elemental-zcash/zaddr_wasm_parser", async () => {
  const { loadAddressParser } = await import("../zcash/__tests__/parser");
  return loadAddressParser();
});

beforeEach(() => {
  installCrypto(new IDBFactory());
  vi.stubGlobal("IDBKeyRange", FakeKeyRange);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("organiser request workflow", () => {
  async function setupBill() {
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
    return { relay, billRecord };
  }

  it("publishes an immutable participant request and reveals the fragment invite URL", async () => {
    const { relay, billRecord } = await setupBill();
    const appUrl = "https://splyt.example.com";

    const published = await publishRequest(relay, billRecord, ALICE, appUrl, { now: NOW });

    expect(published.invite.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(published.invite.readCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(published.invite.reportCapability).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(published.invite.contentKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(published.inviteUrl).toContain("#v=1&r=");
    expect(published.inviteUrl).toContain(`&s=${published.invite.contentKey}`);

    // Request state stored locally
    const reqState = await readLocalRequest(published.invite.requestId);
    expect(reqState).not.toBeNull();
    expect(reqState?.value.role).toBe("organiser");
    expect(reqState?.value.payload.payload.participantLabel).toBe("Alice");

    const allRequests = await listLocalRequests();
    expect(allRequests).toHaveLength(1);
  });

  it("syncs bill requests from the relay", async () => {
    const { relay, billRecord } = await setupBill();
    const appUrl = "https://splyt.example.com";
    const published = await publishRequest(relay, billRecord, ALICE, appUrl, { now: NOW });

    const currentBillRecord = (await listLocalBills())[0];
    const synced = await syncBillRequests(relay, currentBillRecord, [published.state], LATER);

    expect(synced.requests).toHaveLength(1);
    expect(synced.requests[0].requestId).toBe(published.invite.requestId);
    expect(synced.missingRequestIds).toHaveLength(0);
  });

  it("posts a confirmation for a request and updates local state", async () => {
    const { relay, billRecord } = await setupBill();
    const appUrl = "https://splyt.example.com";
    const published = await publishRequest(relay, billRecord, ALICE, appUrl, { now: NOW });

    const currentBillRecord = (await listLocalBills())[0];
    const currentReqRecord = (await listLocalRequests())[0];

    const confirmed = await confirmPayment(relay, currentBillRecord, currentReqRecord, {
      receivedTotalZatoshis: "100000000",
      outcome: "confirmed_by_organiser",
      note: "Confirmed via wallet memo",
      now: LATER,
    });

    expect(confirmed.state.confirmations).toHaveLength(1);
    expect(confirmed.state.confirmations[0].payload.outcome).toBe("confirmed_by_organiser");
    expect(confirmed.state.confirmations[0].payload.receivedTotalZatoshis).toBe("100000000");

    const read = await readLocalRequest(published.invite.requestId);
    expect(read?.value.confirmations).toHaveLength(1);
  });

  it("revokes a published request", async () => {
    const { relay, billRecord } = await setupBill();
    const appUrl = "https://splyt.example.com";
    const published = await publishRequest(relay, billRecord, ALICE, appUrl, { now: NOW });

    const currentBillRecord = (await listLocalBills())[0];
    const requestRecord = (await readLocalRequest(published.invite.requestId))!;
    const revoked = await revokePublishedRequest(relay, currentBillRecord, requestRecord, LATER);

    const entry = revoked.bill.manifest.requests.find((r: RequestInventoryEntry) => r.requestId === published.invite.requestId);
    expect(entry?.lifecycle).toBe("revoked");
    expect(entry?.revokedAt).toBe(LATER);
  });
});

import { IDBFactory, IDBKeyRange as FakeKeyRange } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installCrypto } from "../private-workspace/test-support";
import {
  createBill,
  readLocalBill,
  listLocalBills,
  syncBill,
  archiveBill,
  deleteBill,
  clearLocalBill,
  verifyBillAgainstRelay,
  readEditCapability,
} from "./bill";
import { InMemoryRelayClient } from "./__tests__/relay";
import { MAINNET_SAPLING, TESTNET_SAPLING, NOW, receipt, participants } from "../requests/__tests__/fixtures";
import type { RelayClient } from "../requests/relay";

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

describe("organiser bill workflow", () => {
  it("creates a bill, reserves it on the relay, and stores it encrypted locally", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Dinner with friends",
      receipt: { ...receipt(), title: "Dinner with friends" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "200000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 14,
    };

    const created = await createBill(relay, input, NOW);
    expect(created.billId).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.localRevision).toBe(1);
    expect(created.bill.manifest.title).toBe("Dinner with friends");

    // Local storage verification
    const read = await readLocalBill(created.billId);
    expect(read).not.toBeNull();
    expect(read?.manifest.title).toBe("Dinner with friends");

    // Edit capability stored separately
    const editCap = await readEditCapability(created.billId);
    expect(editCap).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // List verification
    const all = await listLocalBills();
    expect(all).toHaveLength(1);
    expect(all[0].value.manifest.billId).toBe(created.billId);
  });

  it("syncs bill and satisfies the write gate", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Team lunch",
      receipt: { ...receipt(), title: "Team lunch" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "150000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 7,
    };

    const created = await createBill(relay, input, NOW);
    const billRecord = (await listLocalBills())[0];

    const synced = await syncBill(relay, billRecord, NOW);
    expect(synced.bill.manifest.billId).toBe(created.billId);
    expect(synced.localRevision).toBeGreaterThanOrEqual(1);

    const matches = await verifyBillAgainstRelay(relay, synced.bill);
    expect(matches).toBe(true);
  });

  it("archives and un-archives a bill", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Movie night",
      receipt: { ...receipt(), title: "Movie night" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "100000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 7,
    };

    await createBill(relay, input, NOW);
    let billRecord = (await listLocalBills())[0];

    // First sync to satisfy write gate
    await syncBill(relay, billRecord, NOW);
    billRecord = (await listLocalBills())[0];

    // Archive
    const archived = await archiveBill(relay, billRecord, true, NOW);
    expect(archived.bill.manifest.status).toBe("archived");

    billRecord = (await listLocalBills())[0];
    expect(billRecord.value.manifest.status).toBe("archived");

    // Un-archive
    const unarchived = await archiveBill(relay, billRecord, false, NOW);
    expect(unarchived.bill.manifest.status).toBe("active");
  });

  it("clears a bill locally without deleting on relay", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Coffee run",
      receipt: { ...receipt(), title: "Coffee run" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "50000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 7,
    };

    const created = await createBill(relay, input, NOW);
    const billRecord = (await listLocalBills())[0];

    await clearLocalBill(billRecord);

    const read = await readLocalBill(created.billId);
    expect(read).toBeNull();
    const editCap = await readEditCapability(created.billId);
    expect(editCap).toBeNull();

    // Still exists on relay
    const inMem = relay as unknown as InMemoryRelayClient;
    expect(inMem.bills.has(created.billId)).toBe(true);
  });

  it("deletes a bill both on relay and locally", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const input = {
      title: "Groceries",
      receipt: { ...receipt(), title: "Groceries" },
      participants: participants(),
      mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "80000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true,
      expiryDays: 7,
    };

    const created = await createBill(relay, input, NOW);
    let billRecord = (await listLocalBills())[0];

    // Must sync first to satisfy write gate
    await syncBill(relay, billRecord, NOW);
    billRecord = (await listLocalBills())[0];

    await deleteBill(relay, billRecord, NOW);

    // Relay record deleted
    const inMem = relay as unknown as InMemoryRelayClient;
    expect(inMem.bills.has(created.billId)).toBe(false);

    // Local record deleted
    const read = await readLocalBill(created.billId);
    expect(read).toBeNull();
  });

  it("rejects mainnet and invalid checksums before reserving a bill on the relay", async () => {
    const relay = new InMemoryRelayClient() as unknown as RelayClient;
    const reserve = vi.spyOn(relay, "createBill");
    const input = {
      title: "Dinner", receipt: receipt(), participants: participants(), mode: "equal" as const,
      conversion: { source: "manual" as const, wholeBillZatoshis: "200000000", approvedAt: NOW, quote: null },
      receiving: { address: TESTNET_SAPLING, network: "testnet" as const, type: "sapling" as const, receivers: ["sapling" as const] },
      includeDetails: true, expiryDays: 14,
    };
    await expect(createBill(relay, { ...input, receiving: { ...input.receiving, address: MAINNET_SAPLING, network: "mainnet" } }, NOW)).rejects.toThrow(/testnet/);
    await expect(createBill(relay, { ...input, receiving: { ...input.receiving, address: `${TESTNET_SAPLING.slice(0, -1)}q` } }, NOW)).rejects.toThrow(/checksum/);
    expect(reserve).not.toHaveBeenCalled();
    expect(await listLocalBills()).toEqual([]);
  });
});

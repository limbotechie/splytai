import { createBillManifest } from "../../bills/manifest";
import type { BillManifest, LocalBill, Participant, Receipt } from "../../bills/types";
import { canonicalJson } from "../../private-workspace/format";
import { encryptJson, randomSecret } from "../../private-workspace/crypto";
import type { RelayBill, RelayRequest } from "../relay";
import type { RequestReservation } from "../types";

export const NOW = "2026-03-01T10:00:00.000Z";
export const LATER = "2026-03-01T10:05:00.000Z";
export const EVEN_LATER = "2026-03-01T10:10:00.000Z";
export const BILL_ID = "11111111-1111-4111-8111-111111111111";

export const MAINNET_SAPLING = "zs1jap4fpzz4wj0uh7zavxsju6xrqud6gdkelx4gng8h0t30qv5huz6ar4hpvsxr6tdvza9zasweve";
export const TESTNET_SAPLING = "ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez";

export const ORGANISER = "organiser";
export const ALICE = "alice";

export function receipt(): Receipt {
  return {
    title: "Dinner",
    currency: "USD",
    scale: 2,
    items: [{ id: "fries", label: "Fries", amountMinor: "900", assigneeIds: [ORGANISER, ALICE] }],
    taxMinor: "0",
    tipMinor: "0",
    discountMinor: "0",
    totalMinor: "900",
    reviewed: true,
  };
}

export function participants(): Participant[] {
  return [
    { id: ORGANISER, label: "Me", isOrganiser: true, customMinor: "450" },
    { id: ALICE, label: "Alice", isOrganiser: false, customMinor: "450" },
  ];
}

export async function manifestFixture(billId = BILL_ID): Promise<BillManifest> {
  return createBillManifest({
    billId,
    title: "Dinner",
    receipt: receipt(),
    participants: participants(),
    mode: "equal",
    conversion: { source: "manual", wholeBillZatoshis: "200000000", approvedAt: NOW, quote: null },
    receiving: { address: TESTNET_SAPLING, network: "testnet", type: "sapling", receivers: ["sapling"] },
    includeDetails: true,
    expiryDays: 14,
    now: NOW,
  });
}

export function snapshot<T>(value: T): T {
  return JSON.parse(canonicalJson(value)) as T;
}

export function reservation(requestId: string): RequestReservation {
  return { requestId, readCapability: randomSecret(), reportCapability: randomSecret() };
}

export async function encryptedBill(bill: LocalBill): Promise<RelayBill> {
  return {
    id: bill.manifest.billId,
    envelope: await encryptJson(bill.contentKey, bill.manifest, {
      kind: "bill", recordId: bill.manifest.billId, revision: bill.revision,
    }),
    revision: bill.revision,
    retainedUntil: "2026-04-01T10:00:00.000Z",
    requests: [],
  };
}

export function relayRequest(id: string, retention = "2026-04-01T10:00:00.000Z"): RelayRequest {
  return {
    id,
    envelope: null,
    revision: 0,
    reports: [],
    confirmations: [],
    revoked: false,
    retainedUntil: retention,
  };
}

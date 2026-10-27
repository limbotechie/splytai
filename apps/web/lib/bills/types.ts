import type { RateQuote } from "../rates";

export type Network = "testnet" | "mainnet";
export type SplitMode = "equal" | "custom" | "itemised";

export interface ReceiptItem {
  id: string;
  label: string;
  amountMinor: string;
  assigneeIds: string[];
}

export interface Receipt {
  title: string;
  currency: string;
  scale: number;
  items: ReceiptItem[];
  taxMinor: string;
  tipMinor: string;
  discountMinor: string;
  totalMinor: string;
  reviewed: boolean;
}

export interface Participant {
  id: string;
  label: string;
  isOrganiser: boolean;
  customMinor: string;
}

export interface Allocation {
  participantId: string;
  subtotalMinor: string;
  taxMinor: string;
  tipMinor: string;
  discountMinor: string;
  shareMinor: string;
  zatoshis: string;
  isOrganiser: boolean;
}

export interface ApprovedConversion {
  source: "manual" | "coingecko";
  wholeBillZatoshis: string;
  approvedAt: string;
  quote: RateQuote | null;
}

export interface Draft {
  version: 1;
  id: string;
  createdAt: string;
  title: string;
  currency: string;
  items: { id: string; label: string; amount: string; assigneeIds: string[] }[];
  total: string;
  tax: string;
  tip: string;
  discount: string;
  reviewed: boolean;
  participants: { id: string; label: string; isOrganiser: boolean; customAmount: string }[];
  mode: SplitMode;
  includeDetails: boolean;
  address: string;
  zecTotal: string;
  quote: RateQuote | null;
  conversionSource: "manual" | "coingecko";
  approved: boolean;
  expiryDays: number;
}

export interface ReceivingDetails {
  address: string;
  network: Network;
  type: "sapling" | "unified";
  receivers: ("sapling" | "orchard")[];
}

export type BillStatus = "active" | "archived";
export type RequestLifecycle = "active" | "expired" | "revoked" | "cancelled";
export type TrackingState = "unpaid" | "payment_reported" | "partially_confirmed" | "confirmed_by_organiser";

/**
 * One published or reserved request. Capabilities, the content key and the
 * organiser's private signing material are only ever stored inside the encrypted
 * manifest. They are never sent to a participant.
 */
export interface RequestInventoryEntry {
  requestId: string;
  obligationId: string;
  participantId: string;
  participantLabel: string;
  reference: string;
  contentKey: string;
  readCapability: string;
  reportCapability: string;
  amountZatoshis: string;
  address: string;
  network: Network;
  createdAt: string;
  expiresAt: string;
  publishedAt: string | null;
  revokedAt: string | null;
  lifecycle: RequestLifecycle;
  replacementFor: string | null;
  replacedBy: string | null;
}

export interface SigningMaterial {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/** Alias used by strict manifest validation. */
export type SignedKeys = SigningMaterial;

export interface CreateBillManifestInput {
  billId?: string;
  title: string;
  receipt: Receipt;
  participants: Participant[];
  mode: SplitMode;
  conversion: ApprovedConversion;
  receiving: ReceivingDetails;
  includeDetails: boolean;
  expiryDays: number;
  now?: string;
}

/**
 * The organiser's complete, locally encrypted bill inventory. The relay stores
 * this only as one encrypted envelope, so a participant never receives it.
 */
export interface BillManifest {
  version: 1;
  billId: string;
  createdAt: string;
  updatedAt: string;
  status: BillStatus;
  archivedAt: string | null;
  title: string;
  receipt: Receipt;
  participants: Participant[];
  mode: SplitMode;
  allocations: Allocation[];
  conversion: ApprovedConversion;
  receiving: ReceivingDetails;
  signing: SigningMaterial;
  includeDetails: boolean;
  expiryDays: number;
  requests: RequestInventoryEntry[];
}

/** The encrypted record kept only in this browser, including the bill content key. */
export interface LocalBill {
  version: 1;
  contentKey: string;
  revision: number;
  retainedUntil: string | null;
  manifest: BillManifest;
}

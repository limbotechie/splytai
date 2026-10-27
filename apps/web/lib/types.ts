export type Address = `0x${string}`;
export type Hex = `0x${string}`;
export type Micros = bigint;

export type SplitMode = "equal" | "itemised" | "custom";

export interface ReceiptItem {
  name: string;
  amount: string;
  quantity?: number;
  unitPrice?: string;
}

export interface ParsedReceipt {
  title?: string;
  items: ReceiptItem[];
  subtotal: string;
  tax: string;
  tip?: string;
  total: string;
  currency: string;
}

export interface SessionMemberSummary {
  address: Address;
  amount: string;
  paid: boolean;
  paidAt: number | null;
  paymentTxHash: string | null;
}

export interface SessionSummary {
  id: string;
  host: Address;
  members: SessionMemberSummary[];
  total: string;
  createdAt: number;
  expiresAt: number;
  mode: SplitMode;
  receipt: ParsedReceipt;
  allPaid: boolean;
  createTxHash: string | null;
  closeTxHash: string | null;
  closedAt: number | null;
}

export interface SessionDetail extends SessionSummary {
  chainStatus?: "live" | "missing";
  chainActive?: boolean;
}

export interface LiveMember {
  address: Address;
  amountDue: string;
  paid: boolean;
  paidAt: number | null;
}

export interface LiveSession {
  members: LiveMember[];
  allPaid: boolean;
  active: boolean;
  chainStatus?: "live" | "missing";
}

export interface DraftSession {
  id: string;
  receipt: ParsedReceipt;
  members: string[];
  includeOrganiser?: boolean;
  organiserCustomAmount?: string;
  mode: SplitMode;
  amounts: string[];
  assignments?: Record<number, string[]>;
  expiresInMinutes: number;
  createdAt: number;
}

export interface ApiError {
  error: string;
  message: string;
  statusCode: number;
}

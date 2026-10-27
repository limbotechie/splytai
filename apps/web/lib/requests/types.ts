import type { EncryptedEnvelope, SignedJson } from "../private-workspace/crypto";
import type { Network, RequestLifecycle, TrackingState } from "../bills/types";

export interface RequestReceiptDisclosure {
  title: string;
  currency: string;
  scale: number;
  shareMinor: string;
  subtotalMinor: string;
  taxMinor: string;
  tipMinor: string;
  discountMinor: string;
  itemsTotalMinor: string | null;
  receiptTotalMinor: string | null;
  items: { label: string; amountMinor: string }[] | null;
}

/**
 * The immutable participant-facing offer. Everything here is signed by the
 * bill's ephemeral key and encrypted with that request's own content key.
 */
export interface ImmutableRequestPayload {
  version: 1;
  requestId: string;
  obligationId: string;
  reference: string;
  participantLabel: string;
  amountZatoshis: string;
  address: string;
  network: Network;
  createdAt: string;
  expiresAt: string;
  disclosure: "share-only" | "share-with-items";
  receipt: RequestReceiptDisclosure;
  organiserNote: string | null;
}

export interface PaymentReportPayload {
  version: 1;
  requestId: string;
  obligationId: string;
  claimedZatoshis: string;
  reportedAt: string;
  reference: string | null;
  note: string | null;
}

export type ConfirmationOutcome = "partially_confirmed" | "confirmed_by_organiser" | "overpaid" | "correction";

/**
 * A cumulative acknowledgement. The latest confirmation wins; earlier ones stay
 * in history so a correction is visible to the participant it affects.
 */
export interface ConfirmationPayload {
  version: 1;
  requestId: string;
  obligationId: string;
  receivedTotalZatoshis: string;
  outcome: ConfirmationOutcome;
  confirmedAt: string;
  note: string | null;
  correctionReason: string | null;
  previousConfirmationId: string | null;
}

export interface InviteSecrets {
  version: 1;
  requestId: string;
  readCapability: string;
  reportCapability: string;
  publicKey: string;
  contentKey: string;
}

export interface PreparedRequest {
  version: 1;
  requestId: string;
  obligationId: string;
  participantId: string;
  participantLabel: string;
  reference: string;
  contentKey: string;
  amountZatoshis: string;
  address: string;
  network: Network;
  createdAt: string;
  expiresAt: string;
  replacementFor: string | null;
}

export interface RequestReservation {
  requestId: string;
  readCapability: string;
  reportCapability: string;
}

export interface SealedRequest {
  payload: SignedJson<ImmutableRequestPayload>;
  envelope: EncryptedEnvelope;
  contentKey: string;
  invite: InviteSecrets;
}

export interface ReportRecord {
  id: string;
  envelope: EncryptedEnvelope;
  payload: PaymentReportPayload;
  reportedAt: string;
}

export interface ConfirmationRecord {
  id: string;
  envelope: EncryptedEnvelope;
  payload: ConfirmationPayload;
  confirmedAt: string;
}

/** Local view of one request, for either the organiser or the participant. */
export interface RequestState {
  version: 1;
  requestId: string;
  billId: string | null;
  role: "organiser" | "participant";
  payload: SignedJson<ImmutableRequestPayload>;
  pinnedPublicKey: string;
  contentKey: string;
  revision: number;
  reports: ReportRecord[];
  confirmations: ConfirmationRecord[];
  revoked: boolean;
  retainedUntil: string;
  lifecycle: RequestLifecycle;
  lastSyncedAt: string | null;
}

export interface RequestSummary {
  requestId: string;
  obligationId: string;
  participantLabel: string;
  amountZatoshis: string;
  confirmedZatoshis: string;
  tracking: TrackingState;
  lifecycle: RequestLifecycle;
  expiresAt: string;
  reports: number;
  confirmations: number;
}

export type { TrackingState };

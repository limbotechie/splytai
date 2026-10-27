import { randomSecret, type EncryptedEnvelope } from "../../private-workspace/crypto";
import type {
  RelayBill,
  RelayClient,
  RelayCreatedBill,
  RelayRateQuote,
  RelayRequest,
  RelayReservation,
  RelayUpdate,
  RelayWriteResult,
} from "../../requests/relay";
import { RelayApiError } from "../../requests/relay";

interface StoredRelayRequest {
  id: string;
  billId: string;
  readCapability: string;
  reportCapability: string;
  envelope: EncryptedEnvelope | null;
  revision: number;
  reports: RelayUpdate[];
  confirmations: RelayUpdate[];
  revoked: boolean;
  retainedUntil: string;
}

interface StoredRelayBill {
  id: string;
  editCapability: string;
  envelope: EncryptedEnvelope | null;
  revision: number;
  retainedUntil: string;
  requests: Map<string, StoredRelayRequest>;
}

export class InMemoryRelayClient implements Partial<RelayClient> {
  public bills = new Map<string, StoredRelayBill>();
  public requests = new Map<string, StoredRelayRequest>();

  public retentionPeriodDays = 30;

  private makeRetentionDate(): string {
    const d = new Date();
    d.setDate(d.getDate() + this.retentionPeriodDays);
    return d.toISOString();
  }

  async health(): Promise<{ ok: true }> {
    return { ok: true };
  }

  async rates(currency: string): Promise<RelayRateQuote> {
    const now = new Date().toISOString();
    return {
      source: "coingecko",
      currency,
      price: "50.00",
      updatedAt: now,
      fetchedAt: now,
    };
  }

  async createBill(input: { id: string; operationId: string }): Promise<RelayCreatedBill> {
    if (this.bills.has(input.id)) {
      throw new RelayApiError(409, "Bill already exists.", false);
    }
    const editCapability = randomSecret();
    const retainedUntil = this.makeRetentionDate();
    const stored: StoredRelayBill = {
      id: input.id,
      editCapability,
      envelope: null,
      revision: 0,
      retainedUntil,
      requests: new Map(),
    };
    this.bills.set(input.id, stored);
    return {
      id: input.id,
      editCapability,
      revision: 0,
      retainedUntil,
    };
  }

  async getBill(id: string, editCapability: string): Promise<RelayBill> {
    const bill = this.bills.get(id);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    const reqs: RelayRequest[] = Array.from(bill.requests.values()).map((r) => ({
      id: r.id,
      envelope: r.envelope,
      revision: r.revision,
      reports: [...r.reports],
      confirmations: [...r.confirmations],
      revoked: r.revoked,
      retainedUntil: r.retainedUntil,
    }));
    return {
      id: bill.id,
      envelope: bill.envelope,
      revision: bill.revision,
      retainedUntil: bill.retainedUntil,
      requests: reqs,
    };
  }

  async updateBill(
    id: string,
    editCapability: string,
    input: { operationId: string; expectedRevision: number; envelope: EncryptedEnvelope },
  ): Promise<RelayWriteResult> {
    const bill = this.bills.get(id);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    if (bill.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    bill.revision += 1;
    bill.envelope = input.envelope;
    return {
      id: bill.id,
      revision: bill.revision,
      retainedUntil: bill.retainedUntil,
    };
  }

  async deleteBill(
    id: string,
    editCapability: string,
    input: { operationId: string; expectedRevision: number },
  ): Promise<void> {
    const bill = this.bills.get(id);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    if (bill.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    for (const reqId of bill.requests.keys()) {
      this.requests.delete(reqId);
    }
    this.bills.delete(id);
  }

  async reserveRequest(
    billId: string,
    editCapability: string,
    input: { id: string; operationId: string },
  ): Promise<RelayReservation> {
    const bill = this.bills.get(billId);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    const readCapability = randomSecret();
    const reportCapability = randomSecret();
    const retainedUntil = bill.retainedUntil;

    const storedReq: StoredRelayRequest = {
      id: input.id,
      billId,
      readCapability,
      reportCapability,
      envelope: null,
      revision: 0,
      reports: [],
      confirmations: [],
      revoked: false,
      retainedUntil,
    };

    bill.requests.set(input.id, storedReq);
    this.requests.set(input.id, storedReq);

    return {
      id: input.id,
      revision: 0,
      readCapability,
      reportCapability,
      retainedUntil,
    };
  }

  async publishRequest(
    billId: string,
    editCapability: string,
    input: { id: string; operationId: string; expectedRevision: 0; envelope: EncryptedEnvelope },
  ): Promise<RelayWriteResult> {
    const bill = this.bills.get(billId);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    const req = bill.requests.get(input.id);
    if (!req) {
      throw new RelayApiError(404, "Request not found.", false);
    }
    if (req.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    req.revision += 1;
    req.envelope = input.envelope;
    return {
      id: req.id,
      revision: req.revision,
      retainedUntil: req.retainedUntil,
    };
  }

  async revokeRequest(
    id: string,
    editCapability: string,
    input: { operationId: string; expectedRevision: number },
  ): Promise<RelayWriteResult> {
    const req = this.requests.get(id);
    if (!req) {
      throw new RelayApiError(404, "Request not found.", false);
    }
    const bill = this.bills.get(req.billId);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    if (req.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    req.revision += 1;
    req.revoked = true;
    return {
      id: req.id,
      revision: req.revision,
      retainedUntil: req.retainedUntil,
    };
  }

  async getRequest(requestId: string, readCapability: string): Promise<RelayRequest> {
    const req = this.requests.get(requestId);
    if (!req || req.readCapability !== readCapability) {
      throw new RelayApiError(404, "Request not found.", false);
    }
    return {
      id: req.id,
      envelope: req.envelope,
      revision: req.revision,
      reports: [...req.reports],
      confirmations: [...req.confirmations],
      revoked: req.revoked,
      retainedUntil: req.retainedUntil,
    };
  }

  async reportPayment(
    requestId: string,
    reportCapability: string,
    input: { operationId: string; expectedRevision: number; envelope: EncryptedEnvelope },
  ): Promise<RelayWriteResult> {
    const req = this.requests.get(requestId);
    if (!req || req.reportCapability !== reportCapability) {
      throw new RelayApiError(404, "Request not found.", false);
    }
    if (req.revoked) {
      throw new RelayApiError(409, "Request is revoked.", false);
    }
    if (req.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    req.revision += 1;
    req.reports.push({
      id: input.envelope.recordId,
      envelope: input.envelope,
      createdAt: new Date().toISOString(),
    });
    return {
      id: req.id,
      revision: req.revision,
      retainedUntil: req.retainedUntil,
    };
  }

  async postReport(
    requestId: string,
    reportCapability: string,
    input: { operationId: string; updateId?: string; expectedRevision: number; envelope: EncryptedEnvelope },
  ): Promise<RelayWriteResult> {
    return this.reportPayment(requestId, reportCapability, input);
  }

  async putConfirmation(
    requestId: string,
    editCapability: string,
    input: { operationId: string; expectedRevision: number; envelope: EncryptedEnvelope },
  ): Promise<RelayWriteResult> {
    const req = this.requests.get(requestId);
    if (!req) {
      throw new RelayApiError(404, "Request not found.", false);
    }
    const bill = this.bills.get(req.billId);
    if (!bill || bill.editCapability !== editCapability) {
      throw new RelayApiError(404, "Bill not found.", false);
    }
    if (req.revoked) {
      throw new RelayApiError(409, "Request is revoked.", false);
    }
    if (req.revision !== input.expectedRevision) {
      throw new RelayApiError(409, "Revision mismatch.", false);
    }
    req.revision += 1;
    req.confirmations.push({
      id: input.envelope.recordId,
      envelope: input.envelope,
      createdAt: new Date().toISOString(),
    });
    return {
      id: req.id,
      revision: req.revision,
      retainedUntil: req.retainedUntil,
    };
  }
}

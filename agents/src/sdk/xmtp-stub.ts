import { v4 as uuidv4 } from "uuid";

/** In-memory negotiation bus for testing without XMTP network */
export class NegotiationBus {
  private threads = new Map<string, unknown[]>();

  post(negotiationId: string, message: unknown) {
    const thread = this.threads.get(negotiationId) ?? [];
    thread.push(message);
    this.threads.set(negotiationId, thread);
  }

  getThread(negotiationId: string) {
    return this.threads.get(negotiationId) ?? [];
  }

  createNegotiation() {
    return uuidv4();
  }
}

export interface TaskProposalMessage {
  type: "azzle/TaskProposal";
  task: Record<string, unknown>;
}

export interface TaskAcceptanceMessage {
  type: "azzle/TaskAcceptance";
  settlementDigest: string;
}

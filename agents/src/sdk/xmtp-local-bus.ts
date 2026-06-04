import { v4 as uuidv4 } from "uuid";
import type { AzzleEnvelope, MessageHandler, NegotiationTransport } from "./xmtp/types.js";
import { assertValidEnvelope } from "./xmtp/envelope.js";

/** In-memory negotiation bus for testing without XMTP network */
export class NegotiationBus implements NegotiationTransport {
  private threads = new Map<string, AzzleEnvelope[]>();
  private handlers = new Set<MessageHandler>();

  post(negotiationId: string, message: AzzleEnvelope) {
    const thread = this.threads.get(negotiationId) ?? [];
    thread.push(message);
    this.threads.set(negotiationId, thread);
    for (const handler of this.handlers) {
      void handler(message);
    }
  }

  async send(message: AzzleEnvelope): Promise<void> {
    assertValidEnvelope(message);
    this.post(message.negotiationId, message);
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getThread(negotiationId: string) {
    return this.threads.get(negotiationId) ?? [];
  }

  createNegotiation() {
    return uuidv4();
  }
}

/** @deprecated Use envelope payload types from xmtp-spec */
export interface TaskProposalMessage {
  type: "azzle/TaskProposal";
  task: Record<string, unknown>;
}

/** @deprecated Use envelope payload types from xmtp-spec */
export interface TaskAcceptanceMessage {
  type: "azzle/TaskAcceptance";
  settlementDigest: string;
}

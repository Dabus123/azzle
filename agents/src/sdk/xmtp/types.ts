export const ENVELOPE_SCHEMA_VERSION = "azzle-xmtp-v1" as const;
export const IDENTITY_LINK_TYPE = "azzle/identity-link/v1" as const;

export const MESSAGE_TYPES = [
  "TaskProposal",
  "TaskCounterOffer",
  "TaskAcceptance",
  "MilestoneDefinition",
  "RevisionRequest",
  "DeliveryNotice",
  "PaymentRequest",
  "CapabilityProof",
  "DisputeEvidence",
  "ArbitratorProposal",
  "MutualCancel",
  "ReplacementContext",
  "SupervisorVeto",
  "AcceptDelivery",
  "IdentityLink",
] as const;

export type MessageType = (typeof MESSAGE_TYPES)[number];

export interface EnvelopeSender {
  evmAddress: string;
  xmtpPublicKey: string;
}

export interface AzzleEnvelope<TPayload = Record<string, unknown>> {
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  type: MessageType | string;
  negotiationId: string;
  taskId?: string;
  sequence: number;
  previousHash: string;
  timestamp: string;
  sender: EnvelopeSender;
  payload: TPayload;
}

export interface IdentityLink {
  type: typeof IDENTITY_LINK_TYPE;
  xmtpPublicKey: string;
  evmAddress: string;
  signature: string;
  issuedAt: string;
}

export type MessageHandler = (envelope: AzzleEnvelope) => void | Promise<void>;

export interface NegotiationTransport {
  send(message: AzzleEnvelope): Promise<void>;
  subscribe(handler: MessageHandler): () => void;
}

export interface OnChainCorrelationEvent {
  kind:
    | "TaskCreated"
    | "ProofSubmitted"
    | "MilestoneReleased"
    | "DisputeOpened"
    | "DisputeResolved";
  taskId: string;
  negotiationId?: string;
  blockNumber: number;
  txHash: string;
  data: Record<string, unknown>;
}

export type OnChainEventHandler = (event: OnChainCorrelationEvent) => void | Promise<void>;

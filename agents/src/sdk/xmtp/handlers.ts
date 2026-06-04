import type { AzzleClient } from "../client.js";
import { buildSettlementDigest } from "../settlement.js";
import type { TaskTerms } from "../types.js";
import type { AzzleEnvelope } from "./types.js";
import type { XmtpNegotiationTransport } from "./transport.js";
import { assertCounterpartySignature } from "./settlement-verify.js";
import { buildSettlementTypedData } from "./settlement-verify.js";

export type AgentRole = "poster" | "worker";

export interface NegotiationHandlersConfig {
  transport: XmtpNegotiationTransport;
  azzle: AzzleClient;
  evmSigner: import("ethers").Signer;
  role: AgentRole;
  terms: TaskTerms;
  chainId: bigint;
  counterpartyEvm: string;
}

export class NegotiationHandlers {
  constructor(private readonly config: NegotiationHandlersConfig) {}

  private get transport() {
    return this.config.transport;
  }

  private get terms() {
    return this.config.terms;
  }

  async handle(envelope: AzzleEnvelope): Promise<void> {
    switch (envelope.type) {
      case "TaskProposal":
        return this.onTaskProposal(envelope);
      case "TaskCounterOffer":
        return this.onTaskCounterOffer(envelope);
      case "TaskAcceptance":
        return this.onTaskAcceptance(envelope);
      case "MilestoneDefinition":
        return this.onMilestoneDefinition(envelope);
      case "RevisionRequest":
        return this.onRevisionRequest(envelope);
      case "DeliveryNotice":
        return this.onDeliveryNotice(envelope);
      case "PaymentRequest":
        return this.onPaymentRequest(envelope);
      case "CapabilityProof":
        return this.onCapabilityProof(envelope);
      case "DisputeEvidence":
        return this.onDisputeEvidence(envelope);
      case "ArbitratorProposal":
        return this.onArbitratorProposal(envelope);
      case "MutualCancel":
        return this.onMutualCancel(envelope);
      case "ReplacementContext":
        return this.onReplacementContext(envelope);
      case "SupervisorVeto":
        return this.onSupervisorVeto(envelope);
      case "AcceptDelivery":
        return this.onAcceptDelivery(envelope);
      default:
        console.warn(`[negotiation] unhandled type ${envelope.type}`);
    }
  }

  async sendTaskProposal(negotiationId: string, task: Record<string, unknown>): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskProposal",
      negotiationId,
      payload: {
        type: "azzle/TaskProposal",
        task,
        settlementDigestPreview: digest,
      },
    });
  }

  async sendTaskCounterOffer(
    negotiationId: string,
    task: Record<string, unknown>,
    rationale?: string
  ): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskCounterOffer",
      negotiationId,
      payload: {
        type: "azzle/TaskCounterOffer",
        task,
        settlementDigestPreview: digest,
        rationale,
      },
    });
  }

  async signTaskAcceptance(): Promise<{ digest: string; signature: string }> {
    const digest = buildSettlementDigest(this.terms);
    const typed = buildSettlementTypedData({
      settlementDigest: digest,
      poster: this.terms.poster,
      worker: this.terms.worker,
      chainId: this.config.chainId,
    });
    const signature = await this.config.evmSigner.signTypedData(
      typed.domain,
      typed.types,
      typed.message
    );
    return { digest, signature };
  }

  async sendTaskAcceptance(
    negotiationId: string,
    posterSignature: string,
    workerSignature: string,
    task?: Record<string, unknown>
  ): Promise<void> {
    const digest = buildSettlementDigest(this.terms);
    await this.transport.send({
      type: "TaskAcceptance",
      negotiationId,
      payload: {
        type: "azzle/TaskAcceptance",
        settlementDigest: digest,
        posterSignature,
        workerSignature,
        task,
        acceptedAt: new Date().toISOString(),
      },
    });
  }

  async sendDeliveryNotice(
    negotiationId: string,
    params: {
      taskId: string;
      milestoneIndex: number;
      receiptHash: string;
      receiptUri?: string;
      artifactUris?: string[];
    }
  ): Promise<void> {
    if (this.config.role !== "worker") {
      throw new Error("Only the worker may send DeliveryNotice");
    }
    await this.config.azzle.submitProof(
      BigInt(params.taskId),
      params.milestoneIndex,
      params.receiptHash
    );
    await this.transport.send({
      type: "DeliveryNotice",
      negotiationId,
      taskId: params.taskId,
      payload: {
        type: "azzle/DeliveryNotice",
        ...params,
      },
    });
  }

  async sendMilestoneDefinition(
    negotiationId: string,
    taskId: string,
    milestones: Array<{ amount: string; description: string; deadline?: string }>
  ): Promise<void> {
    await this.transport.send({
      type: "MilestoneDefinition",
      negotiationId,
      taskId,
      payload: { type: "azzle/MilestoneDefinition", taskId, milestones },
    });
  }

  async sendRevisionRequest(
    negotiationId: string,
    taskId: string,
    requestedChanges: string
  ): Promise<void> {
    await this.transport.send({
      type: "RevisionRequest",
      negotiationId,
      taskId,
      payload: { type: "azzle/RevisionRequest", taskId, requestedChanges },
    });
  }

  async sendPaymentRequest(
    negotiationId: string,
    payload: {
      taskId: string;
      releaseType: "stream" | "hour_block" | "milestone";
      milestoneIndex?: number;
      amount?: string;
    }
  ): Promise<void> {
    await this.transport.send({
      type: "PaymentRequest",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/PaymentRequest", ...payload },
    });
  }

  async sendCapabilityProof(
    negotiationId: string,
    capabilityId: string,
    evidence: Record<string, unknown>
  ): Promise<void> {
    await this.transport.send({
      type: "CapabilityProof",
      negotiationId,
      payload: { type: "azzle/CapabilityProof", capabilityId, evidence },
    });
  }

  async sendDisputeEvidence(
    negotiationId: string,
    payload: {
      taskId: string;
      disputeId: string;
      claim: "non_delivery" | "quality" | "scope" | "payment" | "other";
      evidenceHashes: string[];
    }
  ): Promise<void> {
    await this.transport.send({
      type: "DisputeEvidence",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/DisputeEvidence", ...payload },
    });
  }

  async sendArbitratorProposal(
    negotiationId: string,
    payload: {
      disputeId: string;
      taskId: string;
      proposedArbitrator: string;
      proposer: string;
    }
  ): Promise<void> {
    await this.transport.send({
      type: "ArbitratorProposal",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/ArbitratorProposal", ...payload },
    });
  }

  async sendMutualCancel(
    negotiationId: string,
    payload: {
      taskId: string;
      posterSignature: string;
      workerSignature: string;
      reason?: string;
    }
  ): Promise<void> {
    await this.transport.send({
      type: "MutualCancel",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/MutualCancel", ...payload, cancelledAt: new Date().toISOString() },
    });
  }

  async sendReplacementContext(
    negotiationId: string,
    payload: {
      taskId: string;
      priorWorker: string;
      newWorker: string;
      handoffPackageHash: string;
    }
  ): Promise<void> {
    await this.transport.send({
      type: "ReplacementContext",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/ReplacementContext", ...payload },
    });
  }

  async sendSupervisorVeto(
    negotiationId: string,
    payload: { taskId: string; supervisor: string; reason: string }
  ): Promise<void> {
    await this.transport.send({
      type: "SupervisorVeto",
      negotiationId,
      taskId: payload.taskId,
      payload: { type: "azzle/SupervisorVeto", ...payload, vetoedAt: new Date().toISOString() },
    });
  }

  async sendAcceptDelivery(
    negotiationId: string,
    params: { taskId: string; milestoneIndex: number; receiptHash?: string }
  ): Promise<void> {
    if (this.config.role !== "poster") {
      throw new Error("Only the poster may send AcceptDelivery");
    }
    await this.config.azzle.acceptMilestone(
      BigInt(params.taskId),
      params.milestoneIndex
    );
    await this.transport.send({
      type: "AcceptDelivery",
      negotiationId,
      taskId: params.taskId,
      payload: {
        type: "azzle/AcceptDelivery",
        taskId: params.taskId,
        milestoneIndex: params.milestoneIndex,
        receiptHash: params.receiptHash,
        acceptedAt: new Date().toISOString(),
      },
    });
  }

  private async onTaskProposal(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "worker") return;
    const payload = envelope.payload as {
      settlementDigestPreview: string;
    };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigestPreview !== expected) {
      throw new Error("TaskProposal digest preview mismatch");
    }
  }

  private async onTaskCounterOffer(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "poster") return;
    const payload = envelope.payload as { settlementDigestPreview: string };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigestPreview !== expected) {
      throw new Error("TaskCounterOffer digest preview mismatch");
    }
  }

  private async onTaskAcceptance(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as {
      settlementDigest: string;
      posterSignature: string;
      workerSignature: string;
    };
    const expected = buildSettlementDigest(this.terms);
    if (payload.settlementDigest !== expected) {
      throw new Error("TaskAcceptance settlement digest mismatch");
    }

    const counterparty = this.config.counterpartyEvm.toLowerCase();
    const poster = this.terms.poster.toLowerCase();
    const worker = this.terms.worker.toLowerCase();

    assertCounterpartySignature(
      payload.settlementDigest,
      payload.posterSignature,
      poster,
      poster,
      worker,
      this.config.chainId
    );
    assertCounterpartySignature(
      payload.settlementDigest,
      payload.workerSignature,
      worker,
      poster,
      worker,
      this.config.chainId
    );

    const counterpartySig =
      this.config.role === "poster" ? payload.workerSignature : payload.posterSignature;
    assertCounterpartySignature(
      payload.settlementDigest,
      counterpartySig,
      counterparty,
      poster,
      worker,
      this.config.chainId
    );

    const hasBoth =
      payload.posterSignature.length > 2 && payload.workerSignature.length > 2;
    if (!hasBoth) return;

    if (this.config.role === "poster") {
      const { taskId } = await this.config.azzle.createTask(this.terms);
      this.transport.bindTaskId(envelope.negotiationId, taskId);
    }
  }

  private async onMilestoneDefinition(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] MilestoneDefinition", envelope.taskId, envelope.payload);
  }

  private async onRevisionRequest(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role !== "worker") return;
    console.log("[negotiation] RevisionRequest", envelope.payload);
  }

  private async onDeliveryNotice(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role === "poster") {
      console.log("[negotiation] DeliveryNotice received", envelope.payload);
    }
  }

  private async onAcceptDelivery(envelope: AzzleEnvelope): Promise<void> {
    if (this.config.role === "worker") {
      console.log("[negotiation] AcceptDelivery received", envelope.payload);
    }
  }

  private async onPaymentRequest(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] PaymentRequest", envelope.payload);
  }

  private async onCapabilityProof(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] CapabilityProof", envelope.payload);
  }

  private async onDisputeEvidence(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] DisputeEvidence", envelope.payload);
  }

  private async onArbitratorProposal(envelope: AzzleEnvelope): Promise<void> {
    const payload = envelope.payload as {
      disputeId: string;
      proposedArbitrator: string;
      proposer: string;
    };
    if (payload.proposer.toLowerCase() !== this.config.counterpartyEvm.toLowerCase()) {
      throw new Error("ArbitratorProposal proposer does not match linked counterparty");
    }
    await this.config.azzle.proposeArbitrator(
      BigInt(payload.disputeId),
      payload.proposedArbitrator
    );
  }

  private async onMutualCancel(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] MutualCancel", envelope.taskId, envelope.payload);
  }

  private async onReplacementContext(envelope: AzzleEnvelope): Promise<void> {
    console.log("[negotiation] ReplacementContext", envelope.payload);
  }

  private async onSupervisorVeto(envelope: AzzleEnvelope): Promise<void> {
    console.warn("[negotiation] SupervisorVeto", envelope.payload);
  }
}

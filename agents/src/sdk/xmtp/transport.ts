import { ethers } from "ethers";
import {
  Client,
  ConsentState,
  IdentifierKind,
  type Dm,
  isText,
} from "@xmtp/node-sdk";
import { v4 as uuidv4 } from "uuid";
import { buildEnvelope, hashEnvelope, assertValidEnvelope } from "./envelope.js";
import type {
  AzzleEnvelope,
  IdentityLink,
  MessageHandler,
  NegotiationTransport,
} from "./types.js";
import { installationPublicKey } from "./signer.js";
import { verifyIdentityLink } from "./identity.js";

export interface XmtpTransportOptions {
  /** EVM address of the active counterparty for the current negotiation DM */
  counterpartyEvm?: string;
}

/**
 * Real XMTP negotiation transport using @xmtp/node-sdk.
 * Exposes send(message) and subscribe(handler) for existing callers.
 */
export class XmtpNegotiationTransport implements NegotiationTransport {
  private handlers = new Set<MessageHandler>();
  private sequenceByNegotiation = new Map<string, number>();
  private previousHashByNegotiation = new Map<string, string>();
  private negotiationTaskMap = new Map<string, string>();
  private taskNegotiationMap = new Map<string, string>();
  private identityByEvm = new Map<string, IdentityLink>();
  private dmByEvm = new Map<string, Dm>();
  private streamStarted = false;

  constructor(
    public readonly xmtpClient: Client,
    private readonly evmSigner: ethers.Signer,
    private options: XmtpTransportOptions = {}
  ) {}

  get negotiationToTaskId(): ReadonlyMap<string, string> {
    return this.negotiationTaskMap;
  }

  get taskIdToNegotiation(): ReadonlyMap<string, string> {
    return this.taskNegotiationMap;
  }

  get linkedIdentities(): ReadonlyMap<string, IdentityLink> {
    return this.identityByEvm;
  }

  createNegotiation(): string {
    return uuidv4();
  }

  bindTaskId(negotiationId: string, taskId: string | bigint): void {
    const id = taskId.toString();
    this.negotiationTaskMap.set(negotiationId, id);
    this.taskNegotiationMap.set(id, negotiationId);
  }

  resolveNegotiationId(taskId: string | bigint): string | undefined {
    return this.taskNegotiationMap.get(taskId.toString());
  }

  registerIdentityLink(link: IdentityLink): void {
    if (!verifyIdentityLink(link)) {
      throw new Error(`Invalid IdentityLink for ${link.evmAddress}`);
    }
    this.identityByEvm.set(link.evmAddress.toLowerCase(), link);
  }

  getLinkedEvmAddress(xmtpPublicKey: string): string | undefined {
    for (const [evm, link] of this.identityByEvm) {
      if (link.xmtpPublicKey === xmtpPublicKey) return evm;
    }
    return undefined;
  }

  requireLinkedEvm(sender: { evmAddress: string; xmtpPublicKey: string }): string {
    const linked = this.identityByEvm.get(sender.evmAddress.toLowerCase());
    if (!linked || linked.xmtpPublicKey !== sender.xmtpPublicKey) {
      throw new Error(`Sender ${sender.evmAddress} has no verified IdentityLink`);
    }
    return linked.evmAddress;
  }

  async connectCounterparty(counterpartyEvm: string): Promise<Dm> {
    const normalized = counterpartyEvm.toLowerCase();
    const existing = this.dmByEvm.get(normalized);
    if (existing) return existing;

    const dm =
      (await this.xmtpClient.conversations.fetchDmByIdentifier({
        identifier: normalized,
        identifierKind: IdentifierKind.Ethereum,
      })) ??
      (await this.xmtpClient.conversations.createDmWithIdentifier({
        identifier: normalized,
        identifierKind: IdentifierKind.Ethereum,
      }));

    dm.updateConsentState(ConsentState.Allowed);
    this.dmByEvm.set(normalized, dm);
    this.options.counterpartyEvm = normalized;
    return dm;
  }

  private async senderMeta(): Promise<{ evmAddress: string; xmtpPublicKey: string }> {
    return {
      evmAddress: (await this.evmSigner.getAddress()).toLowerCase(),
      xmtpPublicKey: installationPublicKey(this.xmtpClient),
    };
  }

  private nextSequence(negotiationId: string): number {
    const next = (this.sequenceByNegotiation.get(negotiationId) ?? 0) + 1;
    this.sequenceByNegotiation.set(negotiationId, next);
    return next;
  }

  async send(partial: Omit<AzzleEnvelope, "schemaVersion" | "sequence" | "previousHash" | "timestamp" | "sender"> & {
    sequence?: number;
    previousHash?: string;
    timestamp?: string;
    sender?: AzzleEnvelope["sender"];
  }): Promise<void> {
    const negotiationId = partial.negotiationId;
    const sequence = partial.sequence ?? this.nextSequence(negotiationId);
    const previousHash =
      partial.previousHash ??
      this.previousHashByNegotiation.get(negotiationId) ??
      "0x" + "00".repeat(32);
    const taskId =
      partial.taskId ?? this.negotiationTaskMap.get(negotiationId);

    const envelope = buildEnvelope({
      type: partial.type,
      negotiationId,
      payload: partial.payload as Record<string, unknown>,
      sender: partial.sender ?? (await this.senderMeta()),
      sequence,
      previousHash,
      taskId,
      timestamp: partial.timestamp,
    });

    assertValidEnvelope(envelope);

    const counterparty =
      this.options.counterpartyEvm ??
      this.inferCounterpartyFromPayload(partial.payload as Record<string, unknown>);
    if (!counterparty) {
      throw new Error("XmtpNegotiationTransport.send: counterpartyEvm not configured");
    }

    const dm = await this.connectCounterparty(counterparty);
    await dm.sendText(JSON.stringify(envelope));
    this.previousHashByNegotiation.set(negotiationId, hashEnvelope(envelope));
  }

  subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    void this.ensureStream();
    return () => {
      this.handlers.delete(handler);
    };
  }

  private async ensureStream(): Promise<void> {
    if (this.streamStarted) return;
    this.streamStarted = true;
    await this.xmtpClient.conversations.syncAll([ConsentState.Allowed]);
    const stream = await this.xmtpClient.conversations.streamAllMessages({
      consentStates: [ConsentState.Allowed],
      onValue: (message) => void this.dispatchMessage(message),
      onError: (error) => console.error("[xmtp] stream error", error),
    });
    void (async () => {
      for await (const message of stream) {
        await this.dispatchMessage(message);
      }
    })();
  }

  private async dispatchMessage(message: Parameters<typeof isText>[0]): Promise<void> {
    if (!isText(message)) return;
    const text = message.content ?? "";
    if (!text) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return;
    }

    try {
      if (this.isIdentityLinkPayload(parsed)) {
        this.registerIdentityLink(parsed);
        return;
      }
      const envelope = assertValidEnvelope(parsed);
      this.requireLinkedEvm(envelope.sender);
      for (const handler of this.handlers) {
        await handler(envelope);
      }
    } catch (err) {
      console.warn("[xmtp] rejected message", err);
    }
  }

  private isIdentityLinkPayload(value: unknown): value is IdentityLink {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as IdentityLink).type === "azzle/identity-link/v1"
    );
  }

  private inferCounterpartyFromPayload(payload: Record<string, unknown>): string | undefined {
    for (const key of ["poster", "worker", "proposer", "priorWorker", "newWorker"]) {
      const v = payload[key];
      if (typeof v === "string" && v.startsWith("0x") && v.length === 42) {
        return v;
      }
    }
    return this.options.counterpartyEvm;
  }

  /** Publish a raw IdentityLink JSON message to the counterparty DM. */
  async publishIdentityLink(link: IdentityLink, counterpartyEvm: string): Promise<void> {
    const dm = await this.connectCounterparty(counterpartyEvm);
    await dm.sendText(JSON.stringify(link));
    this.registerIdentityLink(link);
  }
}

export async function createNegotiationTransport(
  evmSigner: ethers.Signer,
  options?: XmtpTransportOptions & { clientOptions?: Parameters<typeof Client.create>[1] }
): Promise<XmtpNegotiationTransport> {
  const { createXmtpClient } = await import("./signer.js");
  const client = await createXmtpClient(evmSigner, options?.clientOptions);
  return new XmtpNegotiationTransport(client, evmSigner, options);
}

import { randomUUID } from "node:crypto";
import {
  Client,
  ConsentState,
  isText,
  type DecodedMessage,
  type Dm,
} from "@xmtp/node-sdk";
import { ethers, Contract } from "ethers";
import { AzzleClient } from "../sdk/client.js";
import { BASE_MAINNET_MANIFEST } from "../sdk/manifest.js";
import { buildExecutionReceipt } from "../sdk/receipt.js";
import { assertValidEnvelope } from "../sdk/xmtp/envelope.js";
import { resolveXmtpClientOptions } from "../sdk/xmtp/client-config.js";
import { createXmtpClient, installationPublicKey } from "../sdk/xmtp/signer.js";
import { verifyIdentityLink } from "../sdk/xmtp/identity.js";
import type { AzzleEnvelope, IdentityLink } from "../sdk/xmtp/types.js";
import { buildEnvelope } from "../sdk/xmtp/envelope.js";
import { ensureAzlAllowance } from "../sdk/preflight.js";

const REGISTRY_STATE_ABI = [
  "function taskState(uint256 taskId) external view returns (uint8)",
  "function claimTask(uint256 taskId) external",
  "function submitProof(uint256 taskId, uint256 milestoneIndex, bytes32 receiptHash) external",
];

const TASK_POSTED = 1;
const MAX_STREAM_RETRIES = 5;

export interface LiveWorkerConfig {
  privateKey: string;
  rpcUrl: string;
  chainId?: number;
}

export interface LiveWorkerRuntime {
  client: Client;
  azzle: AzzleClient;
  signer: ethers.Wallet;
  inboxId: string;
  evmAddress: string;
  stop: () => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizePing(text: string): string {
  return text.trim().toLowerCase();
}

function extractOnChainTaskId(envelope: AzzleEnvelope): string | undefined {
  if (envelope.taskId) return envelope.taskId;
  const payload = envelope.payload as Record<string, unknown>;
  const task = payload.task as Record<string, unknown> | undefined;
  for (const key of ["onChainTaskId", "taskId", "id"]) {
    const v = payload[key] ?? task?.[key];
    if (typeof v === "string" && /^\d+$/.test(v)) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

export class LiveWorkerService {
  private readonly identityLinks = new Map<string, IdentityLink>();
  private readonly negotiationByConversation = new Map<string, string>();
  private streamAbort = false;
  private streamTask: Promise<void> | null = null;

  constructor(
    private readonly config: LiveWorkerConfig,
    private readonly manifest = BASE_MAINNET_MANIFEST
  ) {}

  async start(): Promise<LiveWorkerRuntime> {
    const rpcUrl = this.config.rpcUrl;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(this.config.privateKey, provider);
    const evmAddress = (await signer.getAddress()).toLowerCase();

    const xmtpClient = await createXmtpClient(signer, resolveXmtpClientOptions());
    const inboxId = xmtpClient.inboxId;

    const azzle = new AzzleClient({
      rpcUrl,
      registryAddress: this.manifest.TaskRegistry,
      escrowAddress: this.manifest.EscrowVault,
      arbitrationAddress: this.manifest.ArbitrationModule,
      signer: { address: evmAddress, signMessage: (m) => signer.signMessage(m) },
    }).connect(signer);

    console.log("[AZZLE Worker] XMTP env:", process.env.XMTP_ENV ?? "production");
    console.log("[AZZLE Worker] XMTP db:", process.env.XMTP_DB_PATH ?? "./.xmtp-db");
    console.log("[AZZLE Worker] EVM address:", evmAddress);
    console.log(`[AZZLE Worker] Listening on XMTP: ${inboxId}`);
    console.log("[AZZLE Worker] xmtp.chat → message this Ethereum address:", evmAddress);

    this.streamAbort = false;
    this.streamTask = this.runMessageStream(xmtpClient, azzle, signer, evmAddress);

    return {
      client: xmtpClient,
      azzle,
      signer,
      inboxId,
      evmAddress,
      stop: () => {
        this.streamAbort = true;
      },
    };
  }

  private async runMessageStream(
    client: Client,
    azzle: AzzleClient,
    signer: ethers.Wallet,
    workerAddress: string
  ): Promise<void> {
    let attempt = 0;

    while (!this.streamAbort) {
      try {
        await client.conversations.syncAll([
          ConsentState.Allowed,
          ConsentState.Unknown,
        ]);

        const stream = await client.conversations.streamAllMessages({
          consentStates: [ConsentState.Allowed, ConsentState.Unknown],
          retryAttempts: MAX_STREAM_RETRIES,
          onError: (error) => {
            console.error("[xmtp] stream error", error);
          },
          onRetry: (n, max) => {
            console.warn(`[xmtp] stream retry ${n}/${max}`);
          },
        });

        attempt = 0;

        for await (const message of stream) {
          if (this.streamAbort) break;
          try {
            await this.handleMessage(client, azzle, signer, workerAddress, message);
          } catch (err) {
            console.error("[worker] message handler error (continuing)", err);
          }
        }
      } catch (err) {
        attempt += 1;
        if (this.streamAbort) return;
        if (attempt > MAX_STREAM_RETRIES) {
          console.error("[xmtp] stream failed after max retries", err);
          throw err;
        }
        const delayMs = Math.min(1000 * 2 ** attempt, 30_000);
        console.warn(
          `[xmtp] reconnecting in ${delayMs}ms (attempt ${attempt}/${MAX_STREAM_RETRIES})`,
          err
        );
        await sleep(delayMs);
      }
    }
  }

  private async handleMessage(
    client: Client,
    azzle: AzzleClient,
    signer: ethers.Wallet,
    workerAddress: string,
    message: DecodedMessage
  ): Promise<void> {
    await this.ensureConversationConsent(client, message.conversationId);

    if (isText(message)) {
      const text = message.content ?? "";
      if (normalizePing(text) === "ping") {
        await this.replyText(client, message, "pong");
        console.log("[worker] ping → pong", { from: message.senderInboxId });
        return;
      }
    }

    const raw = isText(message) ? message.content ?? "" : "";
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (this.isIdentityLink(parsed)) {
      if (verifyIdentityLink(parsed)) {
        this.identityLinks.set(parsed.evmAddress.toLowerCase(), parsed);
        console.log("[worker] identity link registered", parsed.evmAddress);
      }
      return;
    }

    let envelope: AzzleEnvelope;
    try {
      envelope = assertValidEnvelope(parsed);
    } catch (err) {
      console.warn("[worker] invalid envelope (ignored)", err);
      return;
    }

    this.registerSenderIfNeeded(envelope.sender);

    if (envelope.type === "TaskProposal") {
      await this.handleTaskProposal(client, azzle, signer, workerAddress, message, envelope);
      return;
    }

    console.log("[worker] envelope received", {
      type: envelope.type,
      negotiationId: envelope.negotiationId,
      taskId: envelope.taskId,
    });
  }

  private async handleTaskProposal(
    client: Client,
    azzle: AzzleClient,
    signer: ethers.Wallet,
    workerAddress: string,
    message: DecodedMessage,
    envelope: AzzleEnvelope
  ): Promise<void> {
    const taskIdStr = extractOnChainTaskId(envelope);
    if (!taskIdStr) {
      console.warn("[worker] TaskProposal missing on-chain taskId — ignoring");
      return;
    }

    const taskId = BigInt(taskIdStr);
    const registry = new Contract(this.manifest.TaskRegistry, REGISTRY_STATE_ABI, signer);
    const state = Number(await registry.taskState(taskId));

    if (state !== TASK_POSTED) {
      console.warn("[worker] task not POSTED", { taskId: taskIdStr, state });
      return;
    }

    const poster = envelope.sender.evmAddress.toLowerCase();
    console.log("[worker] claiming task", { taskId: taskIdStr, poster });

    try {
      await ensureAzlAllowance(signer, {
        azlToken: this.manifest.azlToken,
        treasuryRouter: this.manifest.TreasuryRouter,
      });
      const claimTx = await azzle.claimTask(taskId);
      await claimTx.wait();
      console.log("[worker] claimTask confirmed", taskIdStr);
    } catch (err) {
      console.error("[worker] claimTask failed", err);
      await this.replyText(
        client,
        message,
        `claim failed for task ${taskIdStr}: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    const deliverableHash = ethers.keccak256(
      ethers.toUtf8Bytes(`azzle-demo:${taskIdStr}:${Date.now()}`)
    );
    const receipt = buildExecutionReceipt({
      taskId: taskIdStr,
      milestoneIndex: 0,
      worker: workerAddress,
      artifacts: [
        {
          type: "deterministic_output",
          hash: deliverableHash,
          uri: "ipfs://azzle-demo-stub",
        },
      ],
    });

    try {
      const proofTx = await azzle.submitProof(taskId, 0, receipt.receiptHash);
      await proofTx.wait();
      console.log("[worker] submitProof confirmed", {
        taskId: taskIdStr,
        receiptHash: receipt.receiptHash,
      });
    } catch (err) {
      console.error("[worker] submitProof failed", err);
      return;
    }

    const negotiationId =
      envelope.negotiationId ||
      this.negotiationByConversation.get(message.conversationId) ||
      randomUUID();
    this.negotiationByConversation.set(message.conversationId, negotiationId);

    const notice = buildEnvelope({
      type: "DeliveryNotice",
      negotiationId,
      taskId: taskIdStr,
      sequence: 1,
      sender: {
        evmAddress: workerAddress,
        xmtpPublicKey: installationPublicKey(client),
      },
      payload: {
        type: "azzle/DeliveryNotice",
        taskId: taskIdStr,
        milestoneIndex: 0,
        receiptHash: receipt.receiptHash,
        receiptUri: "ipfs://azzle-demo-stub",
      },
    });

    await this.replyText(client, message, JSON.stringify(notice));
    console.log("[worker] lifecycle complete", { taskId: taskIdStr, poster });
  }

  private registerSenderIfNeeded(sender: AzzleEnvelope["sender"]): void {
    const key = sender.evmAddress.toLowerCase();
    if (this.identityLinks.has(key)) return;
    this.identityLinks.set(key, {
      type: "azzle/identity-link/v1",
      evmAddress: sender.evmAddress.toLowerCase(),
      xmtpPublicKey: sender.xmtpPublicKey,
      signature: "0x",
      issuedAt: new Date().toISOString(),
    });
  }

  private isIdentityLink(value: unknown): value is IdentityLink {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as IdentityLink).type === "azzle/identity-link/v1"
    );
  }

  private async ensureConversationConsent(
    client: Client,
    conversationId: string
  ): Promise<void> {
    const conversation = await client.conversations.getConversationById(conversationId);
    if (!conversation) return;
    if ("updateConsentState" in conversation) {
      await (conversation as Dm).updateConsentState(ConsentState.Allowed);
    }
  }

  private async replyText(
    client: Client,
    message: DecodedMessage,
    text: string
  ): Promise<void> {
    const conversation = await client.conversations.getConversationById(
      message.conversationId
    );
    if (!conversation) {
      console.warn("[worker] no conversation for reply", message.conversationId);
      return;
    }
    await conversation.sendText(text);
  }
}

export async function startLiveWorker(
  config: LiveWorkerConfig
): Promise<LiveWorkerRuntime> {
  const service = new LiveWorkerService(config);
  return service.start();
}

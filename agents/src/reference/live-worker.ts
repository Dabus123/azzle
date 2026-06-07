import { randomUUID } from "node:crypto";
import { Agent, getInstallationInfo, getTestUrl } from "@xmtp/agent-sdk";
import {
  ConsentEntityType,
  ConsentState,
  IdentifierKind,
  isMarkdown,
  isText,
  Client,
  Dm,
  type Conversation,
  type DecodedMessage,
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
const POLL_INTERVAL_MS = 3_000;
const RECONCILE_PASSES = 8;
const RECONCILE_DELAY_MS = 1_500;
const ALL_CONSENT = [
  ConsentState.Allowed,
  ConsentState.Unknown,
  ConsentState.Denied,
];

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

function isPingMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (normalized === "ping") return true;
  return /\bping\b/.test(normalized);
}

function messageText(message: DecodedMessage): string | undefined {
  if (isText(message) || isMarkdown(message)) {
    return typeof message.content === "string" ? message.content : undefined;
  }
  return undefined;
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
  private readonly seenMessageIds = new Set<string>();
  private streamAbort = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private lastConvCount = -1;
  private pollZeroCount = 0;
  private agent: Agent | null = null;
  private runtime: {
    client: Client;
    azzle: AzzleClient;
    signer: ethers.Wallet;
    workerAddress: string;
  } | null = null;

  constructor(
    private readonly config: LiveWorkerConfig,
    private readonly manifest = BASE_MAINNET_MANIFEST
  ) {}

  async start(): Promise<LiveWorkerRuntime> {
    const rpcUrl = this.config.rpcUrl;
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(this.config.privateKey, provider);
    const evmAddress = (await signer.getAddress()).toLowerCase();

    const client = await createXmtpClient(signer, {
      ...resolveXmtpClientOptions(),
      disableDeviceSync: false,
      appVersion: "azzle-worker/0.1.0",
    });
    const inboxId = client.inboxId;

    await this.prepareInstallation(client);
    await this.logNetworkRegistration(client, evmAddress);

    const azzle = new AzzleClient({
      rpcUrl,
      registryAddress: this.manifest.TaskRegistry,
      escrowAddress: this.manifest.EscrowVault,
      arbitrationAddress: this.manifest.ArbitrationModule,
      signer: { address: evmAddress, signMessage: (m) => signer.signMessage(m) },
    }).connect(signer);

    this.runtime = { client, azzle, signer, workerAddress: evmAddress };
    this.streamAbort = false;

    const installInfo = await getInstallationInfo(client);
    console.log("[worker] installation info", installInfo);

    await this.syncAndLog(client, "startup");
    await this.reconcileConversations(client, "startup");
    await this.logDmPeers(client, "startup");
    await this.probePeerIfConfigured(client);
    await this.reconcileConversations(client, "post-probe");
    await this.logDmPeers(client, "post-probe");
    await this.logKeyPackage(client);
    await this.catchUpExistingMessages(client);

    this.agent = await this.setupAgent(client);
    this.pollInterval = setInterval(() => void this.pollInbox(), POLL_INTERVAL_MS);
    void this.pollInbox();

    const dmUrl = getTestUrl(client);
    console.log("[AZZLE Worker] XMTP env:", process.env.XMTP_ENV ?? "production");
    console.log("[AZZLE Worker] XMTP db:", process.env.XMTP_DB_PATH ?? "./.xmtp-db");
    console.log("[AZZLE Worker] EVM address:", evmAddress);
    console.log("[AZZLE Worker] installation:", client.installationId);
    console.log(`[AZZLE Worker] Listening on XMTP: ${inboxId}`);
    console.log("[AZZLE Worker] OPEN THIS URL (1:1 DM):");
    console.log(`[AZZLE Worker] ${dmUrl}`);
    if (process.env.XMTP_PROBE_ADDRESS) {
      const probe = process.env.XMTP_PROBE_ADDRESS.trim().toLowerCase();
      console.log("[AZZLE Worker] probe DM sent to", probe);
      console.log("");
      console.log("╔══════════════════════════════════════════════════════════════╗");
      console.log("║  xmtp.chat MUST use this wallet (top-right):                 ║");
      console.log(`║  ${probe}  ║`);
      console.log("║                                                            ║");
      console.log("║  1. Incognito window → xmtp.chat/production                ║");
      console.log("║  2. Connect the wallet above — NOT an old thread           ║");
      console.log("║  3. Wait for: AZZLE worker online — reply ping               ║");
      console.log("║  4. Reply: ping                                            ║");
      console.log("║                                                            ║");
      console.log("║  Old ping-only threads are DEAD after .xmtp-db resets.     ║");
      console.log("╚══════════════════════════════════════════════════════════════╝");
      console.log("");
    } else {
      console.log(
        "[AZZLE Worker] tip: set XMTP_PROBE_ADDRESS=<your xmtp.chat wallet> in .env to open DM from worker"
      );
    }

    return {
      client,
      azzle,
      signer,
      inboxId,
      evmAddress,
      stop: () => {
        this.streamAbort = true;
        if (this.pollInterval) clearInterval(this.pollInterval);
        void this.agent?.stop();
      },
    };
  }

  private async logNetworkRegistration(
    client: Client,
    evmAddress: string
  ): Promise<void> {
    const xmtpEnv = (process.env.XMTP_ENV ?? "production") as "production";
    try {
      const canMsg = await Client.canMessage(
        [{ identifier: evmAddress, identifierKind: IdentifierKind.Ethereum }],
        xmtpEnv
      );
      const onNetwork = canMsg.get(evmAddress) ?? false;
      console.log("[worker] address on XMTP network:", onNetwork, evmAddress);

      const inboxState = await client.preferences.fetchInboxState();
      const installIds = inboxState.installations.map((i) => i.id);
      console.log("[worker] installations on network:", installIds);
      console.log(
        "[worker] this installation published:",
        installIds.includes(client.installationId)
      );

      if (!onNetwork) {
        console.warn("[worker] calling register() — address not found on network");
        await client.register();
        const retry = await Client.canMessage(
          [{ identifier: evmAddress, identifierKind: IdentifierKind.Ethereum }],
          xmtpEnv
        );
        console.log("[worker] address on XMTP network after register:", retry.get(evmAddress));
      }
    } catch (err) {
      console.warn("[worker] network registration check failed", err);
    }
  }

  private async prepareInstallation(client: Client): Promise<void> {
    try {
      const inboxState = await client.preferences.fetchInboxState();
      const installationCount = inboxState.installations.length;
      console.log("[worker] inbox installations on network:", installationCount);
      console.log("[worker] this installation:", client.installationId);

      if (installationCount > 1) {
        console.warn(
          "[worker] multiple installations detected — xmtp.chat threads tied to an OLD installation will not deliver messages"
        );
        console.warn(
          "[worker] open a NEW DM on xmtp.chat after any .xmtp-db reset (do not reuse old ping threads)"
        );
        if (process.env.XMTP_REVOKE_OTHER_INSTALLATIONS === "true") {
          console.log("[worker] revoking other installations (XMTP_REVOKE_OTHER_INSTALLATIONS=true)");
          await client.revokeAllOtherInstallations();
          console.log("[worker] other installations revoked — all xmtp.chat users must start a fresh DM");
        } else {
          console.warn(
            "[worker] keeping other installations (set XMTP_REVOKE_OTHER_INSTALLATIONS=true to revoke after migrating)"
          );
        }
      }
    } catch (err) {
      console.warn("[worker] installation setup failed", err);
    }
  }

  private async probePeerIfConfigured(client: Client): Promise<void> {
    const peer = process.env.XMTP_PROBE_ADDRESS?.trim().toLowerCase();
    if (!peer || !peer.startsWith("0x") || peer.length !== 42) {
      console.log(
        "[worker] no XMTP_PROBE_ADDRESS — worker will only see DMs after sync picks up welcomes"
      );
      return;
    }
    try {
      const xmtpEnv = (process.env.XMTP_ENV ?? "production") as "production";
      const canMsg = await Client.canMessage(
        [{ identifier: peer, identifierKind: IdentifierKind.Ethereum }],
        xmtpEnv
      );
      if (!canMsg.get(peer)) {
        console.error(
          "[worker] XMTP_PROBE_ADDRESS is NOT registered on XMTP:",
          peer
        );
        console.error(
          "[worker] set XMTP_PROBE_ADDRESS to the wallet connected on xmtp.chat (top-right)"
        );
        return;
      }

      let dm = await client.conversations.fetchDmByIdentifier({
        identifier: peer,
        identifierKind: IdentifierKind.Ethereum,
      });

      if (!dm) {
        console.log(
          "[worker] waiting for xmtp.chat welcome DM (do not create duplicate)..."
        );
        for (let i = 0; i < 5; i++) {
          await client.conversations.sync();
          await client.conversations.syncAll(ALL_CONSENT);
          dm = await client.conversations.fetchDmByIdentifier({
            identifier: peer,
            identifierKind: IdentifierKind.Ethereum,
          });
          if (dm) break;
          await sleep(2000);
        }
      }

      if (!dm) {
        console.log("[worker] creating probe DM (no welcome received from xmtp.chat)");
        dm = await client.conversations.createDmWithIdentifier({
          identifier: peer,
          identifierKind: IdentifierKind.Ethereum,
        });
      } else {
        console.log("[worker] using existing DM from network", dm.id);
      }

      dm.updateConsentState(ConsentState.Allowed);
      await this.allowPeerInbox(client, dm);
      await dm.sync();

      const duplicates = await dm.duplicateDms();
      if (duplicates.length > 0) {
        console.log(
          "[worker] WARNING: duplicate DMs with same peer — syncing all",
          duplicates.map((d) => d.id)
        );
        for (const dup of duplicates) {
          await this.prepareConversation(client, dup);
          await dup.sync();
        }
      }

      await dm.sendText("AZZLE worker online — reply ping");
      console.log("[worker] probe DM opened with", peer, {
        conversationId: dm.id,
        peerInboxId: dm.peerInboxId,
        duplicates: duplicates.length,
      });
      console.log("[AZZLE Worker] VERIFY on xmtp.chat (wallet " + peer + "):");
      console.log("[AZZLE Worker]   you MUST see: \"AZZLE worker online — reply ping\"");
      console.log("[AZZLE Worker]   if you only see your old pings, open a NEW chat:");
      console.log(`[AZZLE Worker]   ${getTestUrl(client)}`);
    } catch (err) {
      console.warn("[worker] probe DM failed", err);
    }
  }

  private async allowPeerInbox(client: Client, dm: Dm): Promise<void> {
    await client.preferences.setConsentStates([
      {
        entityType: ConsentEntityType.InboxId,
        entity: dm.peerInboxId,
        state: ConsentState.Allowed,
      },
      {
        entityType: ConsentEntityType.GroupId,
        entity: dm.id,
        state: ConsentState.Allowed,
      },
    ]);
  }

  private async expandConversations(client: Client): Promise<Conversation[]> {
    const seen = new Set<string>();
    const out: Conversation[] = [];
    const add = (conversation: Conversation) => {
      if (seen.has(conversation.id)) return;
      seen.add(conversation.id);
      out.push(conversation);
    };

    const listed = await client.conversations.list({
      consentStates: ALL_CONSENT,
    });
    for (const conversation of listed) add(conversation);

    for (const dm of client.conversations.listDms({ consentStates: ALL_CONSENT })) {
      add(dm);
      try {
        for (const duplicate of await dm.duplicateDms()) add(duplicate);
      } catch (err) {
        console.warn("[worker] duplicateDms failed", dm.id, err);
      }
    }

    for (const group of client.conversations.listGroups({
      consentStates: ALL_CONSENT,
    })) {
      add(group);
    }

    return out;
  }

  private async reconcileConversations(
    client: Client,
    label: string
  ): Promise<void> {
    for (let pass = 0; pass < RECONCILE_PASSES; pass++) {
      await client.conversations.sync();
      const summary = await client.conversations.syncAll(ALL_CONSENT);
      console.log(`[worker] reconcile (${label}) pass ${pass + 1}`, summary);
      if (summary.numSynced > 0) break;
      await sleep(RECONCILE_DELAY_MS);
    }

    const conversations = await this.expandConversations(client);
    console.log(`[worker] reconcile (${label}) conversations`, conversations.length);

    for (const conversation of conversations) {
      await this.prepareConversation(client, conversation);
      if (conversation instanceof Dm) {
        await this.allowPeerInbox(client, conversation);
      }
      await conversation.sync();
      const messages = await conversation.messages({ limit: 30 });
      const peerCount = messages.filter(
        (m) => m.senderInboxId !== client.inboxId
      ).length;
      if (peerCount > 0) {
        console.log("[worker] reconcile found peer messages", {
          conversationId: conversation.id,
          peerCount,
        });
      }
    }
  }

  private async logDmPeers(client: Client, label: string): Promise<void> {
    const dms = client.conversations.listDms({ consentStates: ALL_CONSENT });
    if (dms.length === 0) {
      console.log(`[worker] dms (${label}): none`);
      return;
    }
    const peerInboxIds = dms.map((dm) => dm.peerInboxId);
    const addressByInbox = new Map<string, string>();
    try {
      const xmtpEnv = (process.env.XMTP_ENV ?? "production") as
        | "production"
        | "dev"
        | "local";
      const states = await Client.fetchInboxStates(peerInboxIds, xmtpEnv);
      for (const state of states) {
        const eth = state.identifiers.find(
          (id: { identifierKind: IdentifierKind }) =>
            id.identifierKind === IdentifierKind.Ethereum
        );
        if (eth) addressByInbox.set(state.inboxId, eth.identifier.toLowerCase());
      }
    } catch {
      // non-fatal — inbox lookup is for logging only
    }
    console.log(`[worker] dms (${label})`, {
      count: dms.length,
      peers: dms.map((dm) => ({
        conversationId: dm.id,
        peerInboxId: dm.peerInboxId,
        peerAddress: addressByInbox.get(dm.peerInboxId),
      })),
    });
  }

  private async syncAndLog(client: Client, label: string): Promise<number> {
    await client.preferences.sync();
    const welcomeSync = await client.conversations.sync();
    const summary = await client.conversations.syncAll(ALL_CONSENT);
    const dms = client.conversations.listDms({ consentStates: ALL_CONSENT });
    const groups = client.conversations.listGroups({ consentStates: ALL_CONSENT });
    const total = dms.length + groups.length;
    if (total !== this.lastConvCount) {
      console.log(`[worker] sync (${label})`, {
        conversations: total,
        dms: dms.length,
        groups: groups.length,
        welcomeSync,
        summary,
      });
      this.lastConvCount = total;
    } else if (total === 0 && label === "poll") {
      this.pollZeroCount += 1;
      if (this.pollZeroCount % 5 === 0) {
        console.log("[worker] still 0 conversations synced — set XMTP_PROBE_ADDRESS in .env");
      }
    }
    return total;
  }

  private async logKeyPackage(client: Client): Promise<void> {
    try {
      const statuses = await client.fetchKeyPackageStatuses([
        client.installationId,
      ]);
      console.log("[worker] key package", statuses[client.installationId]);
    } catch (err) {
      console.warn("[worker] key package check failed", err);
    }
  }

  private async catchUpExistingMessages(client: Client): Promise<void> {
    const conversations = await this.expandConversations(client);
    for (const conversation of conversations) {
      await this.prepareConversation(client, conversation);
      await conversation.sync();
      const messages = await conversation.messages({ limit: 100 });
      const peerCount = messages.filter(
        (m) => m.senderInboxId !== client.inboxId
      ).length;
      console.log("[worker] catch-up", {
        conversationId: conversation.id,
        messages: messages.length,
        peerMessages: peerCount,
      });
      for (const message of messages) {
        await this.handleInboundMessage(message);
      }
    }
  }

  private async setupAgent(client: Client): Promise<Agent> {
    const agent = new Agent({ client });

    agent.errors.use(async (error, _ctx, next) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (/decryption|HPKE|not found/i.test(msg)) {
        console.warn("[worker] ignored stream error:", msg.slice(0, 120));
        return;
      }
      await next(error);
    });

    const allowConversation = async (conversation: Conversation) => {
      conversation.updateConsentState(ConsentState.Allowed);
      await client.preferences.setConsentStates([
        {
          entityType: ConsentEntityType.GroupId,
          entity: conversation.id,
          state: ConsentState.Allowed,
        },
      ]);
    };

    agent.on("dm", async (ctx) => {
      console.log("[worker] new dm", { conversationId: ctx.conversation.id });
      await allowConversation(ctx.conversation);
    });
    agent.on("group", async (ctx) => {
      console.log("[worker] new group", {
        conversationId: ctx.conversation.id,
        name: ctx.conversation.name,
      });
      await allowConversation(ctx.conversation);
    });

    const onTextLike = async (ctx: {
      message: DecodedMessage;
      conversation: Conversation;
    }) => {
      const text = messageText(ctx.message);
      if (!text) return;
      const rt = this.runtime;
      if (!rt) return;
      if (this.seenMessageIds.has(ctx.message.id)) return;
      if (ctx.message.senderInboxId === rt.client.inboxId) return;
      this.seenMessageIds.add(ctx.message.id);

      console.log("[worker] inbound", {
        from: ctx.message.senderInboxId,
        conversationId: ctx.message.conversationId,
        preview: text.slice(0, 80),
      });
      await this.handleTextMessage(ctx.conversation, text);
    };

    agent.on("text", onTextLike);
    agent.on("markdown", onTextLike);

    await agent.start();
    console.log("[worker] agent started (xmtp.chat-compatible streams)");
    return agent;
  }

  private async handleTextMessage(
    conversation: Conversation,
    text: string
  ): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;

    if (isPingMessage(text)) {
      await conversation.sendText("pong");
      console.log("[worker] ping → pong");
      return;
    }

    await this.handleStructuredText(
      conversation,
      text,
      rt.azzle,
      rt.signer,
      rt.workerAddress
    );
  }

  private async pollInbox(): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;
    try {
      await this.syncAndLog(rt.client, "poll");
      const conversations = await this.expandConversations(rt.client);
      let peerMessages = 0;
      let newPeerMessages = 0;
      for (const conversation of conversations) {
        await this.prepareConversation(rt.client, conversation);
        await conversation.sync();
        const messages = await conversation.messages({ limit: 50 });
        const fromPeer = messages.filter(
          (m) => m.senderInboxId !== rt.client.inboxId
        );
        peerMessages += fromPeer.length;
        const unhandled = fromPeer.filter((m) => !this.seenMessageIds.has(m.id));
        newPeerMessages += unhandled.length;
        if (unhandled.length > 0) {
          const last = unhandled[unhandled.length - 1];
          const preview = messageText(last);
          console.log("[worker] poll NEW peer message(s)", {
            conversationId: conversation.id,
            newCount: unhandled.length,
            preview: preview?.slice(0, 80),
          });
        }
        for (const message of messages) {
          await this.handleInboundMessage(message);
        }
      }
      if (conversations.length > 0 && peerMessages === 0) {
        this.pollZeroCount += 1;
        if (this.pollZeroCount % 10 === 0) {
          console.log(
            "[worker] poll: conversations exist but 0 peer messages in local db — run npm run diagnose"
          );
        }
      } else if (newPeerMessages === 0 && peerMessages > 0) {
        this.pollZeroCount += 1;
        if (this.pollZeroCount % 20 === 0) {
          console.log(
            "[worker] poll: peer messages in db but all already handled (waiting for NEW ping)"
          );
        }
      } else {
        this.pollZeroCount = 0;
      }
    } catch (err) {
      console.warn("[worker] poll failed", err);
    }
  }

  private async prepareConversation(
    client: Client,
    conversation: Conversation
  ): Promise<void> {
    conversation.updateConsentState(ConsentState.Allowed);
    await client.preferences.setConsentStates([
      {
        entityType: ConsentEntityType.GroupId,
        entity: conversation.id,
        state: ConsentState.Allowed,
      },
    ]);
    await conversation.sync();
  }

  private async handleInboundMessage(message: DecodedMessage): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;
    if (this.seenMessageIds.has(message.id)) return;
    if (message.senderInboxId === rt.client.inboxId) return;
    this.seenMessageIds.add(message.id);

    await rt.client.preferences.setConsentStates([
      {
        entityType: ConsentEntityType.InboxId,
        entity: message.senderInboxId,
        state: ConsentState.Allowed,
      },
      {
        entityType: ConsentEntityType.GroupId,
        entity: message.conversationId,
        state: ConsentState.Allowed,
      },
    ]);

    const conversation = await rt.client.conversations.getConversationById(
      message.conversationId
    );
    if (!conversation) {
      console.warn("[worker] missing conversation", message.conversationId);
      return;
    }

    const text = messageText(message);
    if (!text) return;

    console.log("[worker] inbound (catch-up/poll)", {
      from: message.senderInboxId,
      conversationId: message.conversationId,
      preview: text.slice(0, 80),
    });

    await this.handleTextMessage(conversation, text);
  }

  private async handleStructuredText(
    conversation: Conversation,
    raw: string,
    azzle: AzzleClient,
    signer: ethers.Wallet,
    workerAddress: string
  ): Promise<void> {
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
      await this.handleTaskProposal(
        conversation,
        azzle,
        signer,
        workerAddress,
        envelope
      );
    }
  }

  private async handleTaskProposal(
    conversation: Conversation,
    azzle: AzzleClient,
    signer: ethers.Wallet,
    workerAddress: string,
    envelope: AzzleEnvelope
  ): Promise<void> {
    const rt = this.runtime;
    if (!rt) return;

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

    console.log("[worker] claiming task", { taskId: taskIdStr });

    try {
      await ensureAzlAllowance(signer, {
        azlToken: this.manifest.azlToken,
        treasuryRouter: this.manifest.TreasuryRouter,
      });
      const claimTx = await azzle.claimTask(taskId);
      await claimTx.wait();
    } catch (err) {
      console.error("[worker] claimTask failed", err);
      await conversation.sendText(
        `claim failed: ${err instanceof Error ? err.message : String(err)}`
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
    } catch (err) {
      console.error("[worker] submitProof failed", err);
      return;
    }

    const conversationId = conversation.id;
    const negotiationId =
      envelope.negotiationId ||
      this.negotiationByConversation.get(conversationId) ||
      randomUUID();
    this.negotiationByConversation.set(conversationId, negotiationId);

    const notice = buildEnvelope({
      type: "DeliveryNotice",
      negotiationId,
      taskId: taskIdStr,
      sequence: 1,
      sender: {
        evmAddress: workerAddress,
        xmtpPublicKey: installationPublicKey(rt.client),
      },
      payload: {
        type: "azzle/DeliveryNotice",
        taskId: taskIdStr,
        milestoneIndex: 0,
        receiptHash: receipt.receiptHash,
        receiptUri: "ipfs://azzle-demo-stub",
      },
    });

    await conversation.sendText(JSON.stringify(notice));
    console.log("[worker] lifecycle complete", { taskId: taskIdStr });
  }

  private registerSenderIfNeeded(sender: AzzleEnvelope["sender"]): void {
    const key = sender.evmAddress.toLowerCase();
    if (this.identityLinks.has(key)) return;
    this.identityLinks.set(key, {
      type: "azzle/identity-link/v1",
      evmAddress: key,
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
}

export async function startLiveWorker(
  config: LiveWorkerConfig
): Promise<LiveWorkerRuntime> {
  return new LiveWorkerService(config).start();
}

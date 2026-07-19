import { loadEnvConfig } from "./config.js";
import { PostgresStore } from "./graph/postgres.js";
import { Neo4jStore } from "./graph/neo4j.js";
import { QdrantStore } from "./graph/qdrant.js";
import { GraphWriter } from "./graph/writer.js";
import { EventBus } from "./events/bus.js";
import { LocalEventBus } from "./events/local-bus.js";
import { LlmGateway } from "./llm/gateway.js";
import { GitHubClient } from "./tools/github.js";
import { AzzleBaseRpc } from "./tools/azzle.js";
import { TemporalClient } from "./temporal/client.js";
import { LiteStore } from "./lite/store.js";
import { LitePostgresStore, LiteNeo4jStore, LiteQdrantStore } from "./lite/adapters.js";
import { createOutreachDelivery, createRedditDelivery, createFarcasterDelivery, logDeliveryStatus } from "./delivery/factory.js";
import type { ForceContext } from "./context.js";
import { AGENT_FACTORIES, agentsForWave, ALL_AGENT_IDS } from "./agents/registry.js";
import type { BaseAgent } from "./agents/base.js";
import { Messenger } from "./agents/outreach/messenger.js";
import { startReplyWebhookServer, type ReplyWebhookServer } from "./delivery/reply-webhook-server.js";

let activeLiteStore: LiteStore | null = null;
let activeReplyWebhook: ReplyWebhookServer | null = null;

function registerLiteShutdown(): void {
  const flush = async () => {
    if (activeLiteStore) {
      await activeLiteStore.close();
    }
  };
  process.once("SIGINT", () => {
    flush().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    flush().finally(() => process.exit(0));
  });
}

async function createLiteContext(includeTemporal = true): Promise<ForceContext> {
  const config = loadEnvConfig();
  console.log("[orchestrator] lite mode — file-backed graph (no Docker)");

  const lite = new LiteStore(config.liteDataPath);
  activeLiteStore = lite;
  registerLiteShutdown();
  const postgres = new LitePostgresStore(lite);
  const neo4j = new LiteNeo4jStore(lite);
  const qdrant = new LiteQdrantStore(lite);
  const bus = new LocalEventBus();
  const llm = new LlmGateway({ baseUrl: config.openaiBaseUrl, apiKey: config.bankrApiKey });
  const github = new GitHubClient(config.githubToken);
  const azzle = new AzzleBaseRpc();
  const delivery = createOutreachDelivery();
  const reddit = createRedditDelivery();
  const farcaster = createFarcasterDelivery();
  logDeliveryStatus(delivery, config.outreachDmEnabled, reddit, farcaster);

  await postgres.migrate();
  await neo4j.verify();
  await qdrant.initCollections();
  await bus.connect();

  const writer = new GraphWriter(
    postgres as unknown as PostgresStore,
    neo4j as unknown as Neo4jStore,
    qdrant as unknown as QdrantStore,
    bus as unknown as EventBus
  );

  return {
    config,
    postgres: postgres as unknown as PostgresStore,
    neo4j: neo4j as unknown as Neo4jStore,
    qdrant: qdrant as unknown as QdrantStore,
    writer,
    bus: bus as unknown as EventBus,
    llm,
    github,
    azzle,
    delivery,
    reddit,
    farcaster,
    temporal: undefined,
  };
}

export async function createContext(includeTemporal = true): Promise<ForceContext> {
  const config = loadEnvConfig();
  if (config.liteMode) {
    return createLiteContext(includeTemporal);
  }

  const postgres = new PostgresStore(config.postgresUrl);
  const neo4j = new Neo4jStore(config.neo4jUri, config.neo4jUser, config.neo4jPassword);
  const qdrant = new QdrantStore(config.qdrantUrl);
  const bus = new EventBus(config.natsUrl);
  const llm = new LlmGateway({ baseUrl: config.openaiBaseUrl, apiKey: config.bankrApiKey });
  const github = new GitHubClient(config.githubToken);
  const azzle = new AzzleBaseRpc();
  const delivery = createOutreachDelivery();
  const reddit = createRedditDelivery();
  const farcaster = createFarcasterDelivery();
  logDeliveryStatus(delivery, config.outreachDmEnabled, reddit, farcaster);

  try {
    await postgres.migrate();
    await neo4j.verify();
    await qdrant.initCollections();
    await bus.connect();
  } catch (err) {
    await postgres.close().catch(() => {});
    await neo4j.close().catch(() => {});
    await bus.close().catch(() => {});
    console.error(`
Cannot connect to graph stack (Postgres / Neo4j / Qdrant / NATS).

  Docker not running?  npm run lite
  Or install Docker:  https://docs.docker.com/desktop/setup/install/windows-install/
  Then:             npm run up && npm run migrate
`);
    throw err;
  }

  let temporal: TemporalClient | undefined;
  if (includeTemporal) {
    temporal = new TemporalClient(config);
    try {
      await temporal.connect();
    } catch {
      console.warn("[orchestrator] Temporal unavailable — follow-up workflows disabled");
      temporal = undefined;
    }
  }

  const writer = new GraphWriter(postgres, neo4j, qdrant, bus);

  return {
    config,
    postgres,
    neo4j,
    qdrant,
    writer,
    bus,
    llm,
    github,
    azzle,
    delivery,
    reddit,
    farcaster,
    temporal,
  };
}

export async function startWave(wave?: number | "all"): Promise<BaseAgent[]> {
  const ctx = await createContext();
  const raw = wave ?? ctx.config.wave;
  const w = raw === "all" || raw === 0 ? ("all" as const) : raw;
  const ids = agentsForWave(w, ctx.config);

  if (ids.length === 0) {
    throw new Error(`No agents configured for wave ${String(w)}`);
  }

  const label = w === "all" ? "all (waves 1–3 + 6)" : String(w);
  console.log(`[orchestrator] starting wave ${label}: ${ids.join(", ")}`);
  const agents = ids.map((id) => AGENT_FACTORIES[id](ctx));
  for (const agent of agents) {
    agent.start().catch((err) => console.error(`[${agent.identity.id}] fatal:`, err));
  }

  if (process.env.AZZLE_REPLY_WEBHOOK !== "false") {
    activeReplyWebhook = await startReplyWebhookServer(ctx);
  }

  return agents;
}

export async function startAgent(agentId: string): Promise<BaseAgent> {
  const factory = AGENT_FACTORIES[agentId];
  if (!factory) {
    throw new Error(`Unknown agent: ${agentId}. Valid: ${ALL_AGENT_IDS.join(", ")}`);
  }
  const ctx = await createContext();
  const agent = factory(ctx);
  await agent.start();
  return agent;
}

export async function approveOutreach(entityId: string): Promise<void> {
  const ctx = await createContext(false);
  const messenger = new Messenger(ctx);
  await messenger.approveAndSend(entityId);
}

export async function shutdown(ctx: ForceContext): Promise<void> {
  if (activeReplyWebhook) {
    await activeReplyWebhook.close().catch(() => {});
    activeReplyWebhook = null;
  }
  await ctx.postgres.close();
  await ctx.neo4j.close();
  await ctx.bus.close();
}

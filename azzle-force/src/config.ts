import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { loadOutreachBrand, type OutreachBrand } from "./outreach/brand.js";

export interface BrainConfig {
  enabled?: boolean;
  decayHalfLifeDays?: number;
  minHeatForCloser?: number;
  minEntitiesBeforeBrain?: number;
  evolveIntervalHours?: number;
  evolveAfterOutcomes?: number;
  /** Minimum ai_inclusion_potential (0-1) to allow outreach drafting. */
  minAiInclusionForOutreach?: number;
}

export interface ForceConfig {
  azzleProbabilityThreshold: number;
  minEntitiesBeforeOutreach: number;
  minRankedProspectsBeforeOutreach: number;
  followUpDays: number[];
  hunterBatchSizePerHour: number;
  waves: Record<string, string[]>;
  brain?: BrainConfig;
}

export interface EnvConfig {
  postgresUrl: string;
  neo4jUri: string;
  neo4jUser: string;
  neo4jPassword: string;
  qdrantUrl: string;
  natsUrl: string;
  temporalAddress: string;
  temporalNamespace: string;
  temporalTaskQueue: string;
  bankrApiKey: string;
  openaiBaseUrl: string;
  githubToken: string;
  subgraphUrl: string;
  baseRpcUrl: string;
  wave: number;
  humanApproveOutreach: boolean;
  outreachDmEnabled: boolean;
  outreachPreferEmail: boolean;
  outreachBrand: OutreachBrand;
  liteMode: boolean;
  liteDataPath: string;
  forceConfig: ForceConfig;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dir, "..");

function loadDotenv(): void {
  dotenv.config({ path: resolve(packageRoot, ".env") });
  dotenv.config({ path: resolve(packageRoot, ".env.local"), override: true });
}

function loadForceConfig(): ForceConfig {
  const path =
    process.env.AZZLE_FORCE_CONFIG ??
    resolve(__dir, "..", "config", "default.json");
  const config = JSON.parse(readFileSync(path, "utf8")) as ForceConfig;
  if (process.env.AZZLE_PROBABILITY_THRESHOLD) {
    config.azzleProbabilityThreshold = Number(process.env.AZZLE_PROBABILITY_THRESHOLD);
  }
  return config;
}

export function loadEnvConfig(): EnvConfig {
  loadDotenv();
  const forceConfig = loadForceConfig();
  const liteMode =
    process.env.AZZLE_FORCE_LITE === "1" || process.env.AZZLE_FORCE_LITE === "true";
  return {
    postgresUrl:
      process.env.POSTGRES_URL ?? "postgres://azzle:azzle@localhost:5432/azzle_force",
    neo4jUri: process.env.NEO4J_URI ?? "bolt://localhost:7687",
    neo4jUser: process.env.NEO4J_USER ?? "neo4j",
    neo4jPassword: process.env.NEO4J_PASSWORD ?? "azzleforce",
    qdrantUrl: process.env.QDRANT_URL ?? "http://localhost:6333",
    natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
    temporalAddress: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? "default",
    temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? "azzle-force",
    bankrApiKey: process.env.BANKR_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://llm.bankr.bot/v1",
    githubToken: process.env.GITHUB_TOKEN ?? "",
    subgraphUrl:
      process.env.AZZLE_SUBGRAPH_URL ??
      "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3",
    baseRpcUrl: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    wave: Number(process.env.AZZLE_FORCE_WAVE ?? "1"),
    humanApproveOutreach: process.env.HUMAN_APPROVE_OUTREACH !== "false",
    outreachDmEnabled: process.env.OUTREACH_DM_ENABLED !== "false",
    outreachPreferEmail: process.env.OUTREACH_PREFER_EMAIL !== "false",
    outreachBrand: loadOutreachBrand(),
    liteMode,
    liteDataPath:
      process.env.AZZLE_FORCE_LITE_PATH ?? resolve(packageRoot, ".azzle-force-lite"),
    forceConfig,
  };
}

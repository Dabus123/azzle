import type { EnvConfig } from "./config.js";
import type { PostgresStore } from "./graph/postgres.js";
import type { Neo4jStore } from "./graph/neo4j.js";
import type { QdrantStore } from "./graph/qdrant.js";
import type { GraphWriter } from "./graph/writer.js";
import type { EventBus } from "./events/bus.js";
import type { LlmGateway } from "./llm/gateway.js";
import type { GitHubClient } from "./tools/github.js";
import type { AzzleBaseRpc } from "./tools/azzle.js";
import type { TemporalClient } from "./temporal/client.js";
import type { OutreachDelivery } from "./delivery/index.js";
import type { RedditDelivery } from "./delivery/reddit.js";
import type { FarcasterDelivery } from "./delivery/farcaster.js";

export interface ForceContext {
  config: EnvConfig;
  postgres: PostgresStore;
  neo4j: Neo4jStore;
  qdrant: QdrantStore;
  writer: GraphWriter;
  bus: EventBus;
  llm: LlmGateway;
  github: GitHubClient;
  azzle: AzzleBaseRpc;
  delivery: OutreachDelivery;
  reddit: RedditDelivery | null;
  farcaster: FarcasterDelivery | null;
  temporal?: TemporalClient;
}

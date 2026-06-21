import { createHash } from "node:crypto";
import type { PostgresStore } from "./postgres.js";
import type { Neo4jStore } from "./neo4j.js";
import { labelForType } from "./neo4j.js";
import type { QdrantStore } from "./qdrant.js";
import type { EventBus } from "../events/bus.js";
import { SUBJECTS } from "../events/subjects.js";

export interface GraphWriteInput {
  agent: string;
  type: string;
  name: string;
  metadata?: Record<string, unknown>;
  entityId?: string;
  embedText?: string;
  embedCollection?: "repositories" | "communities" | "outreach" | "entities";
  relationships?: Array<{ toId: string; type: string; props?: Record<string, unknown> }>;
  score?: { type: string; value: number; reason?: string };
  natsSubject?: string;
  natsPayload?: Record<string, unknown>;
}

export class GraphWriter {
  constructor(
    private postgres: PostgresStore,
    private neo4j: Neo4jStore,
    private qdrant: QdrantStore,
    private bus: EventBus
  ) {}

  async write(input: GraphWriteInput): Promise<string> {
    const entityId = await this.postgres.upsertEntity(
      input.type,
      input.name,
      input.metadata ?? {},
      input.entityId
    );

    await this.neo4j.upsertNode(entityId, [labelForType(input.type)], {
      type: input.type,
      name: input.name,
      ...input.metadata,
    });

    if (input.relationships) {
      for (const rel of input.relationships) {
        await this.neo4j.createRelationship(entityId, rel.toId, rel.type, rel.props);
        await this.bus.publish(
          SUBJECTS.GRAPH_RELATIONSHIP_CREATED,
          input.agent,
          { from: entityId, to: rel.toId, type: rel.type },
          entityId
        );
      }
    }

    if (input.embedText && input.embedCollection) {
      await this.qdrant.upsert(input.embedCollection, entityId, input.embedText, {
        type: input.type,
        name: input.name,
      });
    }

    if (input.score) {
      await this.postgres.upsertScore(
        entityId,
        input.score.type,
        input.score.value,
        input.score.reason
      );
      await this.bus.publish(
        SUBJECTS.SCORE_UPDATED,
        input.agent,
        { score_type: input.score.type, value: input.score.value },
        entityId
      );
    }

    await this.bus.publish(
      SUBJECTS.GRAPH_ENTITY_UPDATED,
      input.agent,
      { type: input.type, name: input.name },
      entityId
    );

    if (process.env.AZZLE_FORCE_LITE !== "1" && process.env.AZZLE_FORCE_LITE !== "true") {
      await this.postgres.logAudit(input.agent, "entity_upsert", {
        type: input.type,
        name: input.name,
      }, entityId);
    }

    if (input.natsSubject) {
      await this.bus.publish(
        input.natsSubject,
        input.agent,
        input.natsPayload ?? {},
        entityId
      );
    }

    return entityId;
  }

  static hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}

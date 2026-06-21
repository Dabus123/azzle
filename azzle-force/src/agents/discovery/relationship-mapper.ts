import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "relationship-mapper",
  name: "Relationship Mapper",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Create and maintain edges between all entity types in Neo4j.",
  publishSubjects: [SUBJECTS.GRAPH_RELATIONSHIP_CREATED],
  subscribeSubjects: [
    SUBJECTS.DISCOVERY_REPO_FOUND,
    SUBJECTS.DISCOVERY_AGENT_FOUND,
    SUBJECTS.DISCOVERY_COMMUNITY_FOUND,
    SUBJECTS.MISSION_ASSIGNED,
  ],
};

const FALLBACK_REL = "RELATED_TO";

/** Heuristic edges — avoids LLM calls that flood the gateway during lite:all. */
function heuristicRelationship(
  a: { type: string; name: string; metadata?: unknown },
  b: { type: string; name: string; metadata?: unknown }
): string {
  const types = new Set([a.type, b.type]);
  const aMeta = JSON.stringify(a.metadata ?? {});
  const bMeta = JSON.stringify(b.metadata ?? {});

  if (types.has("person") && types.has("repository")) {
    if (aMeta.includes(b.name) || bMeta.includes(a.name)) return "OWNS";
    return "BUILT";
  }
  if (types.has("company") && types.has("repository")) return "OWNS";
  if (types.has("agent") && types.has("repository")) return "USES";
  if (types.has("person") && types.has("company")) return "BUILT";
  if (types.has("person") && types.has("agent")) return "BUILT";
  if (types.has("agent") && types.has("community")) return "MEMBER_OF";
  if (types.has("person") && types.has("community")) return "MEMBER_OF";
  return FALLBACK_REL;
}

export class RelationshipMapper extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    await this.mapNeighbors(msg.entity_id, 3);
  }

  protected async tick(): Promise<void> {
    const types = ["person", "company", "agent", "repository", "community", "task"];
    let totalEdges = 0;
    for (const type of types) {
      const batch = await this.ctx.postgres.listEntities(10, type);
      for (const e of batch) {
        totalEdges += await this.mapNeighbors(e.id, 5);
      }
    }
    if (totalEdges > 0) {
      console.log(`[${this.identity.id}] tick — ${totalEdges} edges`);
    }
  }

  private async mapNeighbors(entityId: string, maxEdges = 5): Promise<number> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return 0;

    const others = await this.ctx.postgres.listEntities(40);
    let created = 0;
    const entityMeta = JSON.stringify(entity.metadata);

    for (const other of others) {
      if (other.id === entityId || created >= maxEdges) continue;
      const otherMeta = JSON.stringify(other.metadata);
      const shared =
        entityMeta.includes(other.name) || otherMeta.includes(entity.name);
      if (!shared) continue;

      const relType = heuristicRelationship(entity, other);
      await this.ctx.neo4j.createRelationship(entityId, other.id, relType, {
        source: "relationship-mapper",
      });
      created++;
    }

    return created;
  }
}

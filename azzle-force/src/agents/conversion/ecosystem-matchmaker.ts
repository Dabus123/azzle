import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { z } from "zod";

const MatchSchema = z.object({
  matches: z.array(
    z.object({
      from_entity_id: z.string(),
      to_entity_id: z.string(),
      match_type: z.string(),
      reason: z.string(),
    })
  ),
});

const ID: AgentIdentity = {
  id: "ecosystem-matchmaker",
  name: "Ecosystem Matchmaker",
  layer: "conversion",
  modelTier: "medium",
  mission: "Create high-value connections within the ecosystem.",
  publishSubjects: [SUBJECTS.GRAPH_RELATIONSHIP_CREATED],
  subscribeSubjects: [SUBJECTS.GRAPH_RELATIONSHIP_CREATED, SUBJECTS.MISSION_ASSIGNED],
};

export class EcosystemMatchmaker extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const builders = await this.ctx.postgres.listEntities(10, "person");
    const tasks = await this.ctx.postgres.listEntities(10, "task");
    const agents = await this.ctx.postgres.listEntities(10, "agent");
    const companies = await this.ctx.postgres.listEntities(10, "company");

    let matchCount = 0;
    if (builders.length && tasks.length) {
      await this.ctx.neo4j.createRelationship(builders[0].id, tasks[0].id, "MATCHED", {
        match_type: "builder_task",
      });
      matchCount++;
    }
    if (agents.length && companies.length) {
      await this.ctx.neo4j.createRelationship(agents[0].id, companies[0].id, "MATCHED", {
        match_type: "agent_startup",
      });
      matchCount++;
    }

    const snapshot = { builders, tasks, agents, companies };
    const result = await this.llmJson(
      { ecosystem: snapshot, deterministic_matches: matchCount },
      MatchSchema,
      "Suggest additional match types; from_entity_id/to_entity_id must be real UUIDs from ecosystem snapshot only."
    );

    for (const m of result.matches) {
      const validIds = new Set(
        [...builders, ...tasks, ...agents, ...companies].map((e) => e.id)
      );
      if (!validIds.has(m.from_entity_id) || !validIds.has(m.to_entity_id)) continue;

      await this.ctx.neo4j.createRelationship(m.from_entity_id, m.to_entity_id, "MATCHED", {
        match_type: m.match_type,
        reason: m.reason,
      });
      await this.ctx.bus.publish(
        SUBJECTS.GRAPH_RELATIONSHIP_CREATED,
        this.identity.id,
        m,
        m.from_entity_id
      );
      matchCount++;
    }
    console.log(`[${this.identity.id}] created ${matchCount} matches`);
  }
}

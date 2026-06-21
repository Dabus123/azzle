import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { MissionAssignmentSchema } from "../../types.js";

const HUNTER_TYPES = [
  "repository-hunter",
  "agent-hunter",
  "builder-hunter",
  "startup-hunter",
  "community-hunter",
  "opportunity-hunter",
];

const ID: AgentIdentity = {
  id: "chief-expansion",
  name: "Chief Expansion Agent",
  layer: "expansion",
  modelTier: "frontier",
  mission: "Allocate missions and direct swarm growth. Never performs outreach.",
  publishSubjects: [SUBJECTS.MISSION_ASSIGNED],
  subscribeSubjects: [SUBJECTS.SCORE_UPDATED, SUBJECTS.MISSION_ASSIGNED],
};

export class ChiefExpansion extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const entityCount = await this.ctx.postgres.countEntities();
    const top = await this.ctx.postgres.topScoredEntities("azzle_probability", 20);
    const staleMissions = await this.ctx.postgres.listPendingMissions("repository-hunter");

    const assignment = await this.llmJson(
      {
        entity_count: entityCount,
        high_score_entities: top,
        stale_mission_count: staleMissions.length,
        gates: {
          min_entities: this.ctx.config.forceConfig.minEntitiesBeforeOutreach,
          outreach_threshold: this.ctx.config.forceConfig.azzleProbabilityThreshold,
        },
      },
      MissionAssignmentSchema,
      "Chief Expansion: allocate missions ONLY. Never draft outreach. Strategy for AZZLE growth on Base."
    );

    const missions = assignment.missions ?? [];

    for (const m of missions) {
      await this.ctx.postgres.createMission(
        m.agent_type,
        m.target_entity_id,
        m.payload as Record<string, unknown>
      );
      await this.ctx.bus.publish(
        SUBJECTS.MISSION_ASSIGNED,
        this.identity.id,
        { agent_type: m.agent_type, payload: m.payload },
        m.target_entity_id
      );
    }

    // Default hunter throughput if LLM returns empty
    if (missions.length === 0) {
      const hunter = HUNTER_TYPES[Math.floor(Date.now() / 86400000) % HUNTER_TYPES.length];
      await this.ctx.postgres.createMission(hunter, undefined, { reason: "daily_rotation" });
      await this.ctx.bus.publish(SUBJECTS.MISSION_ASSIGNED, this.identity.id, { agent_type: hunter });
    }

    console.log(`[${this.identity.id}] strategy: ${assignment.strategy_summary}`);
  }
}

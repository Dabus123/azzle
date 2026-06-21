import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { QualificationCoreSchema } from "../../types.js";

const ID: AgentIdentity = {
  id: "qualification",
  name: "Qualification Agent",
  layer: "conversion",
  modelTier: "medium",
  mission: "Score prospects on likelihood of AZZLE adoption.",
  publishSubjects: [SUBJECTS.SCORE_UPDATED],
  subscribeSubjects: [SUBJECTS.DISCOVERY_REPO_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

const SCORE_BATCH = 50;

export class Qualification extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (msg.entity_id) await this.scoreEntity(msg.entity_id);
  }

  protected async tick(): Promise<void> {
    const entities = await this.ctx.postgres.listUnscoredEntities(SCORE_BATCH);
    for (const e of entities) {
      await this.scoreEntity(String(e.id));
    }
    if (entities.length > 0) {
      console.log(`[${this.identity.id}] scored batch of ${entities.length} (unscored queue)`);
    }
  }

  private async scoreEntity(entityId: string): Promise<void> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return;

    const slice = await this.ctx.neo4j.getEntitySlice(entityId);
    const result = await this.llmJson(
      {
        entity_id: entityId,
        name: entity.name,
        type: entity.type,
        metadata: entity.metadata,
        graph: slice,
        search_text: entity.name,
      },
      QualificationCoreSchema,
      "Score azzle_probability 0-1 based on fit for AZZLE agent task markets on Base."
    );

    await this.ctx.writer.write({
      agent: this.identity.id,
      type: entity.type,
      name: entity.name,
      entityId,
      metadata: {
        azzle_probability: result.azzle_probability,
        activity_score: result.activity_score ?? result.azzle_probability,
      },
      score: {
        type: "azzle_probability",
        value: result.azzle_probability,
        reason: result.reason,
      },
    });
  }
}

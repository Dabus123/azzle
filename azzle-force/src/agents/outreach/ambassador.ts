import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "ambassador",
  name: "Ambassador Agent",
  layer: "outreach",
  modelTier: "medium",
  mission: "Maintain ongoing relationships — all state in graph, no local CRM.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.OUTREACH_REPLIED, SUBJECTS.OUTREACH_SENT, SUBJECTS.MISSION_ASSIGNED],
};

export class Ambassador extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    if (subject === SUBJECTS.OUTREACH_REPLIED) {
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "person",
        name: (await this.ctx.postgres.getEntity(msg.entity_id))?.name ?? msg.entity_id,
        entityId: msg.entity_id,
        metadata: { ambassador_status: "active", last_reply: new Date().toISOString() },
        score: { type: "engagement", value: 1, reason: "replied to outreach" },
      });
    }
  }

  protected async tick(): Promise<void> {
    const active = await this.ctx.postgres.topScoredEntities("engagement", 10);
    for (const row of active) {
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: row.type,
        name: row.name,
        entityId: row.id,
        metadata: { ambassador_checkin: new Date().toISOString() },
      });
    }
  }
}

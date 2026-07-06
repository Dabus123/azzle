import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { draftCloserMessage } from "../../brain/outreach-engine.js";

const ID: AgentIdentity = {
  id: "closer",
  name: "Closer",
  layer: "brain",
  modelTier: "frontier",
  mission: "Convert warm prospects — booked call, first post, or explicit yes.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY],
  subscribeSubjects: [SUBJECTS.OUTREACH_REPLIED, SUBJECTS.SCORE_UPDATED, SUBJECTS.OUTCOME_RECORDED],
};

const MAX_PER_TICK = 5;

export class Closer extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (msg.entity_id && subject === SUBJECTS.OUTREACH_REPLIED) {
      await this.tryClose(msg.entity_id);
    }
  }

  protected async tick(): Promise<void> {
    const minHeat = this.ctx.config.forceConfig.brain?.minHeatForCloser ?? 0.55;
    let closed = 0;

    const warm = await this.ctx.postgres.topByScore("relationship_heat", minHeat, 30);
    for (const row of warm) {
      if (closed >= MAX_PER_TICK) break;
      const entityId = String(row.id);
      const latest = await this.ctx.postgres.getLatestOutreach(entityId, ["replied"]);
      if (latest?.status === "replied") {
        const ok = await this.tryClose(entityId);
        if (ok) closed++;
      }
    }

    const sentIds = await this.ctx.postgres.entitiesWithLatestOutreachStatus("sent");
    for (const entityId of sentIds) {
      if (closed >= MAX_PER_TICK) break;
      const history = await this.ctx.postgres.listOutreachForEntity(entityId);
      if (history.some((o) => o.status === "replied" || o.status === "converted")) continue;
      const sends = history.filter((o) => o.status === "sent").length;
      if (sends < 2) continue;
      const score = await this.ctx.postgres.getScore(entityId, "azzle_probability");
      if ((score?.value ?? 0) < 0.65) continue;
      const ok = await this.tryClose(entityId, true);
      if (ok) closed++;
    }

    if (closed > 0) {
      console.log(`[${this.identity.id}] drafted ${closed} close attempt(s)`);
    }
  }

  private async tryClose(entityId: string, skipHeatCheck = false): Promise<boolean> {
    const pending = await this.ctx.postgres.getLatestOutreach(entityId, ["draft", "pending_approval"]);
    if (pending) return false;

    const heat = await this.ctx.postgres.getScore(entityId, "relationship_heat");
    const minHeat = this.ctx.config.forceConfig.brain?.minHeatForCloser ?? 0.55;
    if (!skipHeatCheck && (heat?.value ?? 0) < minHeat) {
      return false;
    }

    console.log(`[${this.identity.id}] closing ${entityId} (heat=${heat?.value?.toFixed(2)})`);
    await draftCloserMessage(this.ctx, entityId);
    return true;
  }
}

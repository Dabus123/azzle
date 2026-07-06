import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { getAgentPromptExtra } from "../../brain/playbook.js";

const ID: AgentIdentity = {
  id: "strategy-optimizer",
  name: "Strategy Optimizer",
  layer: "brain",
  modelTier: "medium",
  mission: "Adjust Think-layer strategy weights from Learn-layer outcomes.",
  publishSubjects: [SUBJECTS.MISSION_ASSIGNED],
  subscribeSubjects: [SUBJECTS.PLAYBOOK_UPDATED, SUBJECTS.OUTCOME_RECORDED],
};

export class StrategyOptimizer extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.PLAYBOOK_UPDATED) {
      await this.assignMissions();
    }
    if (subject === SUBJECTS.OUTCOME_RECORDED && msg.payload.outcome === "replied") {
      await this.ctx.postgres.createMission("closer", msg.entity_id, { trigger: "reply" });
    }
  }

  protected async tick(): Promise<void> {
    const playbook = getAgentPromptExtra("personalizer");
    if (!playbook) return;
    await this.assignMissions();
  }

  private async assignMissions(): Promise<void> {
    const warm = await this.ctx.postgres.topByScore("relationship_heat", 0.5, 10);
    for (const row of warm) {
      await this.ctx.postgres.createMission("closer", String(row.id), {
        reason: "high_heat",
        heat: row.score_value,
      });
    }
  }
}

import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { tickLiteFollowUps } from "../../outreach/lite-cadence.js";

const ID: AgentIdentity = {
  id: "follow-up",
  name: "Follow-up Agent",
  layer: "outreach",
  modelTier: "medium",
  mission: "Run multi-day follow-up sequences via Temporal or lite cadence.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.OUTREACH_SENT, SUBJECTS.OUTREACH_REPLIED, SUBJECTS.MISSION_ASSIGNED],
};

export class FollowUpAgent extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.OUTREACH_SENT && msg.entity_id && this.ctx.temporal) {
      await this.ctx.temporal.startFollowUp(msg.entity_id);
    }
    if (subject === SUBJECTS.OUTREACH_REPLIED && msg.entity_id && this.ctx.temporal) {
      await this.ctx.temporal.signalReplyReceived(msg.entity_id);
    }
  }

  protected async tick(): Promise<void> {
    if (this.ctx.temporal) return;
    const drafted = await tickLiteFollowUps(this.ctx);
    if (drafted > 0) {
      console.log(`[${this.identity.id}] lite cadence — drafted ${drafted} follow-up(s)`);
    }
  }
}

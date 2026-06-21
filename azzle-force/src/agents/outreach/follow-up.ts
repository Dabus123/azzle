import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "follow-up",
  name: "Follow-up Agent",
  layer: "outreach",
  modelTier: "medium",
  mission: "Run multi-day follow-up sequences via Temporal.",
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
    /* Temporal owns timing */
  }
}

import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { draftSequencerMessage } from "../../brain/outreach-engine.js";

const ID: AgentIdentity = {
  id: "sequencer",
  name: "Sequencer",
  layer: "brain",
  modelTier: "medium",
  mission: "Multi-touch cadences with escalating urgency — not template blasts.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY],
  subscribeSubjects: [SUBJECTS.OUTREACH_SENT, SUBJECTS.OUTREACH_REPLIED],
};

export class Sequencer extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.OUTREACH_REPLIED) return;
    if (subject === SUBJECTS.OUTREACH_SENT && msg.entity_id && this.ctx.temporal) {
      await this.ctx.temporal.startFollowUp(msg.entity_id);
    }
  }

  /** Called from Temporal activities for real follow-up drafts. */
  static async runStep(ctx: ForceContext, entityId: string, step: number): Promise<void> {
    const history = await ctx.postgres.listOutreachForEntity(entityId);
    if (history.some((o) => o.status === "replied")) return;
    await draftSequencerMessage(ctx, entityId, step);
  }

  protected async tick(): Promise<void> {
    /* Temporal drives cadence timing */
  }
}

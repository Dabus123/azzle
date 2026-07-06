import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "outcome-tracker",
  name: "Outcome Tracker",
  layer: "brain",
  modelTier: "cheap",
  mission: "Close the feedback loop — classify sent/replied/converted and feed Learn layer.",
  publishSubjects: [SUBJECTS.OUTCOME_RECORDED],
  subscribeSubjects: [SUBJECTS.OUTREACH_SENT, SUBJECTS.OUTREACH_REPLIED],
};

export class OutcomeTracker extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    const outcome =
      subject === SUBJECTS.OUTREACH_REPLIED
        ? "replied"
        : subject === SUBJECTS.OUTREACH_SENT
          ? "sent"
          : "unknown";
    await this.record(msg.entity_id, outcome, msg.payload);
  }

  protected async tick(): Promise<void> {
    /* Outcomes are recorded on live OUTREACH_SENT / OUTREACH_REPLIED only — no tick replay */
  }

  private async record(
    entityId: string,
    outcome: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.ctx.postgres.logAudit(this.identity.id, "outcome", { outcome, ...payload }, entityId);
    await this.ctx.bus.publish(
      SUBJECTS.OUTCOME_RECORDED,
      this.identity.id,
      { outcome, ...payload },
      entityId
    );
  }
}

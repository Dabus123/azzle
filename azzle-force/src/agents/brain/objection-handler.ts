import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { draftObjectionReframe } from "../../brain/outreach-engine.js";

const ID: AgentIdentity = {
  id: "objection-handler",
  name: "Objection Handler",
  layer: "brain",
  modelTier: "medium",
  mission: "Read replies and reframe resistance with stage-aware responses.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY],
  subscribeSubjects: [SUBJECTS.OUTREACH_REPLIED],
};

export class ObjectionHandler extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    const replyText = String(msg.payload.reply_text ?? msg.payload.body ?? "").trim();
    if (!replyText) return;

    await this.ctx.postgres.logAudit(this.identity.id, "objection_reframe_start", {
      reply_preview: replyText.slice(0, 200),
    }, msg.entity_id);

    console.log(`[${this.identity.id}] reframing reply for ${msg.entity_id}`);
    await draftObjectionReframe(this.ctx, msg.entity_id, replyText);
  }

  protected async tick(): Promise<void> {
    /* event-driven on OUTREACH_REPLIED */
  }
}

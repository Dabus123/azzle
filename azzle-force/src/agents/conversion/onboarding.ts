import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { z } from "zod";

const OnboardingPlanSchema = z.object({
  steps: z.array(z.string()),
  starter_project: z.string(),
  docs_links: z.array(z.string()),
});

const ID: AgentIdentity = {
  id: "onboarding",
  name: "Onboarding Agent",
  layer: "conversion",
  modelTier: "medium",
  mission: "Convert qualified contacts into active AZZLE participants.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.OUTREACH_REPLIED, SUBJECTS.SCORE_UPDATED, SUBJECTS.MISSION_ASSIGNED],
};

const ONBOARDING_DOCS = [
  "https://github.com/Dabus123/azzle/blob/main/QUICKSTART.md",
  "https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md",
  "https://github.com/Dabus123/azzle/blob/main/launch-skills/launch-skills.md",
];

export class Onboarding extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    if (subject === SUBJECTS.OUTREACH_REPLIED || subject === SUBJECTS.SCORE_UPDATED) {
      await this.onboard(msg.entity_id);
    }
  }

  protected async tick(): Promise<void> {
    const top = await this.ctx.postgres.topScoredEntities("azzle_probability", 5);
    for (const row of top) {
      if (row.score_value >= this.ctx.config.forceConfig.azzleProbabilityThreshold) {
        await this.onboard(row.id);
      }
    }
  }

  private async onboard(entityId: string): Promise<void> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return;

    const plan = await this.llmJson(
      {
        entity_id: entityId,
        name: entity.name,
        docs: ONBOARDING_DOCS,
        economics: {
          entry_deposit: "$25 USDC",
          access_fee: "$5 USDC + 1,000 AZZLE",
          chain: "Base 8453",
        },
      },
      OnboardingPlanSchema,
      "Produce AZZLE onboarding steps: wallet, acquire AZZLE, approve, topUp, post/claim tasks."
    );

    if (this.ctx.temporal) {
      await this.ctx.temporal.startOnboardingDrip(entityId, plan.steps);
    }

    await this.ctx.writer.write({
      agent: this.identity.id,
      type: entity.type,
      name: entity.name,
      entityId,
      metadata: {
        onboarding_plan: plan,
        onboarding_status: "in_progress",
      },
    });

    console.log(`[${this.identity.id}] onboarding plan for ${entity.name}: ${plan.steps.length} steps`);
  }
}

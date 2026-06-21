import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { z } from "zod";

const IntelSchema = z.object({
  competitors: z.array(
    z.object({
      name: z.string(),
      threat_level: z.number(),
      notes: z.string(),
    })
  ),
  azzle_differentiators: z.array(z.string()),
});

const WATCH = ["CrewAI", "LangChain", "Microsoft AutoGen", "OpenAI Agents"];

const ID: AgentIdentity = {
  id: "competitive-intelligence",
  name: "Competitive Intelligence",
  layer: "intelligence",
  modelTier: "cheap",
  mission: "Monitor AZZLE alternatives and competitive landscape.",
  publishSubjects: [],
  subscribeSubjects: [],
};

export class CompetitiveIntelligence extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const intel = await this.llmJson(
      { watch_list: WATCH, azzle_position: "USDC escrow task markets on Base, XMTP negotiation" },
      IntelSchema,
      "Brief competitive intel — threat levels 0-1."
    );
    await this.ctx.postgres.logAudit(this.identity.id, "competitive_intel", intel as Record<string, unknown>);
    console.log(`[${this.identity.id}] tracked ${intel.competitors.length} competitors`);
  }
}

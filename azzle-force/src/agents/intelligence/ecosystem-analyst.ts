import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { z } from "zod";

const ReportSchema = z.object({
  summary: z.string(),
  growth_metrics: z.record(z.number()),
  bottlenecks: z.array(z.string()),
  recommendations: z.array(z.string()),
});

const ID: AgentIdentity = {
  id: "ecosystem-analyst",
  name: "Ecosystem Analyst",
  layer: "intelligence",
  modelTier: "frontier",
  mission: "Measure system-wide growth, bottlenecks, and retention from graph data.",
  publishSubjects: [],
  subscribeSubjects: [],
};

export class EcosystemAnalyst extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const entityCount = await this.ctx.postgres.countEntities();
    const nodeCount = await this.ctx.neo4j.countNodes();
    const topProspects = await this.ctx.postgres.topScoredEntities("azzle_probability", 10);
    const agents = await this.ctx.azzle.getTopAgents(10);
    const openTasks = await this.ctx.azzle.getOpenTasks(10);

    const report = await this.llmJson(
      {
        entity_count: entityCount,
        neo4j_nodes: nodeCount,
        top_prospects: topProspects,
        azzle_agents: agents,
        open_tasks: openTasks,
      },
      ReportSchema,
      "Weekly ecosystem report for AZZLE FORCE expansion organism."
    );

    await this.ctx.postgres.logAudit(this.identity.id, "weekly_report", report as Record<string, unknown>);
    console.log(`[${this.identity.id}] report:\n${report.summary}`);
  }
}

import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "opportunity-hunter",
  name: "Opportunity Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find bounties, grants, jobs, and open issues linked to builders.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

export class OpportunityHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const issues = await this.ctx.github.searchIssues(
      "is:issue is:open label:bounty OR label:grant agent OR automation",
      25
    );

    for (const issue of issues) {
      const taskId = await this.ctx.writer.write({
        agent: this.identity.id,
        type: "task",
        name: issue.title.slice(0, 120),
        metadata: { url: issue.html_url, source: "github" },
        embedText: issue.title,
        embedCollection: "entities",
      });

      const repoMatch = issue.repository_url.match(/repos\/(.+)$/);
      if (repoMatch) {
        const repos = await this.ctx.postgres.listEntities(1, "repository");
        const match = repos.find((r: { id: string; name: string }) => r.name === repoMatch[1]);
        if (match) {
          await this.ctx.neo4j.createRelationship(taskId, match.id, "NEEDS");
        }
      }
    }

    const openTasks = await this.ctx.azzle.getOpenTasks(20);
    for (const t of openTasks) {
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "task",
        name: `azzle-task-${t.id}`,
        metadata: {
          azzle_task_id: t.id,
          state: t.state,
          escrow: t.escrowAmount,
          poster: t.poster.id,
          source: "azzle-subgraph",
        },
        embedText: `AZZLE task ${t.id} escrow ${t.escrowAmount}`,
        embedCollection: "entities",
      });
    }

    console.log(
      `[${this.identity.id}] indexed ${issues.length} issues + ${openTasks.length} AZZLE tasks`
    );
  }
}

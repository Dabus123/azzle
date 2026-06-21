import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "startup-hunter",
  name: "Startup Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find startups likely to need autonomous labor or task markets.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

export class StartupHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const repos = await this.ctx.github.searchRepos(
      "AI startup OR crypto agent OR dao automation",
      20
    );
    for (const repo of repos) {
      const companyName = repo.full_name.split("/")[0];
      const entityId = await this.ctx.writer.write({
        agent: this.identity.id,
        type: "company",
        name: companyName,
        metadata: {
          repo: repo.html_url,
          owner: repo.owner.login,
          description: repo.description,
          category: "startup",
        },
        embedText: `startup ${companyName} ${repo.description ?? ""}`,
        embedCollection: "entities",
      });
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "repository",
        name: repo.full_name,
        metadata: { url: repo.html_url },
        relationships: [{ toId: entityId, type: "FOUNDED_BY", props: { reverse: true } }],
      });
    }
    console.log(`[${this.identity.id}] mapped ${repos.length} startup signals`);
  }
}

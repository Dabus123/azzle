import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "repository-hunter",
  name: "Repository Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Scan GitHub for agent and automation repositories.",
  publishSubjects: [SUBJECTS.DISCOVERY_REPO_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

export class RepositoryHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const batch = this.ctx.config.forceConfig.hunterBatchSizePerHour;
    const repos = await this.ctx.github.searchRepos(
      "agent OR crew OR workflow OR automation OR mcp OR autonomous in:name,description,readme",
      Math.min(batch, 30)
    );

    for (const repo of repos) {
      const parsed = await this.hunterEnrich(
        {
          full_name: repo.full_name,
          owner: repo.owner.login,
          html_url: repo.html_url,
          description: repo.description,
          topics: repo.topics,
          stargazers_count: repo.stargazers_count,
        },
        "repository",
        "Focus on repos that ship agents, MCP servers, or automation workflows — not generic dev tools."
      );

      const fit = parsed.azzle_fit ?? 0;
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: parsed.type,
        name: parsed.name,
        metadata: {
          url: parsed.url ?? repo.html_url,
          stars: repo.stargazers_count,
          topics: parsed.skills ?? repo.topics,
          owner: parsed.owner ?? repo.owner.login,
          description: parsed.description ?? repo.description,
        },
        embedText: `${parsed.name} ${parsed.description ?? repo.description ?? ""} ${(parsed.skills ?? []).join(" ")}`,
        embedCollection: "repositories",
        score: {
          type: "azzle_probability",
          value: fit,
          reason: "repository-hunter LLM fit",
        },
        natsSubject: SUBJECTS.DISCOVERY_REPO_FOUND,
        natsPayload: { repo_url: repo.html_url, azzle_probability: fit },
      });
    }
    console.log(`[${this.identity.id}] ingested ${repos.length} repositories`);
  }
}

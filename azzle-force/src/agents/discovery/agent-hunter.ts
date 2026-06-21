import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "agent-hunter",
  name: "Agent Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find existing autonomous agents across public sources.",
  publishSubjects: [SUBJECTS.DISCOVERY_AGENT_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

const QUERIES = [
  "autonomous agent framework",
  "crewai agent",
  "autogen agent",
  "mcp server agent",
  "langgraph agent",
];

export class AgentHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    let count = 0;
    for (const q of QUERIES) {
      const repos = await this.ctx.github.searchRepos(q, 10);
      for (const repo of repos) {
        const parsed = await this.hunterEnrich(
          {
            full_name: repo.full_name,
            owner: repo.owner.login,
            html_url: repo.html_url,
            description: repo.description,
            topics: repo.topics,
            stargazers_count: repo.stargazers_count,
            search_query: q,
          },
          "agent",
          "Classify as agent when the project is an autonomous agent, agent framework, or MCP agent server — not a passive library."
        );

        const fit = parsed.azzle_fit ?? 0;
        await this.ctx.writer.write({
          agent: this.identity.id,
          type: parsed.type,
          name: parsed.name,
          metadata: {
            repo: parsed.repo ?? repo.html_url,
            owner: parsed.owner ?? repo.owner.login,
            description: parsed.description ?? repo.description,
            stars: repo.stargazers_count,
            skills: parsed.skills ?? repo.topics,
            search_query: q,
          },
          embedText: `${parsed.name} autonomous agent ${parsed.description ?? repo.description ?? ""}`,
          embedCollection: "entities",
          score: {
            type: "azzle_probability",
            value: fit,
            reason: "agent-hunter LLM fit",
          },
          natsSubject: SUBJECTS.DISCOVERY_AGENT_FOUND,
          natsPayload: { repo_url: repo.html_url, azzle_probability: fit },
        });
        count++;
      }
    }
    console.log(`[${this.identity.id}] found ${count} agent candidates`);
  }
}

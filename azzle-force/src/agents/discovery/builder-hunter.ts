import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "builder-hunter",
  name: "Builder Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find solo founders, AI builders, and automation consultants.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.DISCOVERY_REPO_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

export class BuilderHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject !== SUBJECTS.DISCOVERY_REPO_FOUND || !msg.entity_id) return;

    const entity = await this.ctx.postgres.getEntity(msg.entity_id);
    if (!entity) return;

    const meta = entity.metadata as {
      owner?: string;
      description?: string;
      stars?: number;
      url?: string;
    };
    const owner = meta.owner ?? entity.name.split("/")[0];

    const parsed = await this.hunterEnrich(
      {
        full_name: owner,
        owner,
        description: meta.description ?? entity.name,
        html_url: meta.url,
        stargazers_count: meta.stars,
        source_repo: entity.name,
      },
      "person",
      "Rate builders: solo founders, AI/automation consultants, indie hackers shipping agent tools. Skip large org accounts."
    );

    const fit = parsed.azzle_fit ?? 0;
    await this.ctx.writer.write({
      agent: this.identity.id,
      type: "person",
      name: parsed.name,
      metadata: {
        source_repo: entity.name,
        owner,
        role: "builder",
        description: parsed.description,
        skills: parsed.skills,
      },
      embedText: `builder ${parsed.name} ${entity.name} ${(parsed.skills ?? []).join(" ")}`,
      embedCollection: "entities",
      score: {
        type: "azzle_probability",
        value: fit,
        reason: "builder-hunter LLM fit",
      },
      relationships: [{ toId: msg.entity_id, type: "OWNS" }],
    });
  }

  protected async tick(): Promise<void> {
    const repos = await this.ctx.github.searchRepos(
      "automation tutorial OR ai builder stars:>50",
      15
    );
    for (const repo of repos) {
      const parsed = await this.hunterEnrich(
        {
          full_name: repo.owner.login,
          owner: repo.owner.login,
          html_url: repo.html_url,
          description: repo.description,
          topics: repo.topics,
          stargazers_count: repo.stargazers_count,
        },
        "person",
        "Identify GitHub users who look like solo AI builders or automation consultants, not corporate org accounts."
      );

      const fit = parsed.azzle_fit ?? 0;
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "person",
        name: parsed.name,
        metadata: {
          highlighted_repo: repo.full_name,
          owner: repo.owner.login,
          stars: repo.stargazers_count,
          description: parsed.description ?? repo.description,
          skills: parsed.skills ?? repo.topics,
        },
        embedText: `AI builder ${parsed.name} ${parsed.description ?? ""}`,
        embedCollection: "entities",
        score: {
          type: "azzle_probability",
          value: fit,
          reason: "builder-hunter LLM fit",
        },
      });
    }
  }
}

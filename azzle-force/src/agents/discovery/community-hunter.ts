import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const COMMUNITIES = [
  { name: "LangChain Discord", members: 50000, url: "https://discord.gg/langchain" },
  { name: "AutoGPT Community", members: 25000, url: "https://discord.gg/autogpt" },
  { name: "r/LocalLLaMA", members: 400000, url: "https://reddit.com/r/LocalLLaMA" },
  { name: "CrewAI Community", members: 15000, url: "https://discord.gg/crewai" },
  { name: "MCP Developers", members: 8000, url: "https://github.com/modelcontextprotocol" },
];

const ID: AgentIdentity = {
  id: "community-hunter",
  name: "Community Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Map communities where builders and agents congregate.",
  publishSubjects: [SUBJECTS.DISCOVERY_COMMUNITY_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

export class CommunityHunter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    for (const c of COMMUNITIES) {
      const fit = Math.min(c.members / 100000, 0.95);
      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "community",
        name: c.name,
        metadata: { members: c.members, url: c.url, azzle_fit: fit },
        embedText: `${c.name} community builders agents ${c.members} members`,
        embedCollection: "communities",
        score: { type: "azzle_probability", value: fit, reason: "community size signal" },
        natsSubject: SUBJECTS.DISCOVERY_COMMUNITY_FOUND,
        natsPayload: { community: c.name, members: c.members, azzle_fit: fit },
      });
    }
    console.log(`[${this.identity.id}] indexed ${COMMUNITIES.length} communities`);
  }
}

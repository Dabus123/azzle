import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { TrendSignalSchema } from "../../types.js";

const ID: AgentIdentity = {
  id: "trend-detector",
  name: "Trend Detector",
  layer: "intelligence",
  modelTier: "cheap",
  mission: "Track agent framework adoption and AI infrastructure signals.",
  publishSubjects: [SUBJECTS.TREND_SIGNAL],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

const WATCH_QUERIES = ["mcp server", "langgraph", "crewai", "autogen", "agent framework 2025"];

export class TrendDetector extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    const signals: Array<{ query: string; count: number }> = [];
    for (const q of WATCH_QUERIES) {
      const repos = await this.ctx.github.searchRepos(q, 5);
      signals.push({ query: q, count: repos.length });
    }

    const signal = await this.llmJson(
      { github_signals: signals },
      TrendSignalSchema,
      "Detect validated niches for AZZLE expansion. spawn_recommended only if strength > 0.7."
    );

    await this.ctx.bus.publish(
      SUBJECTS.TREND_SIGNAL,
      this.identity.id,
      signal as Record<string, unknown>
    );

    if (signal.spawn_recommended) {
      console.log(`[${this.identity.id}] niche signal: ${signal.niche} (${signal.strength})`);
    }
  }
}

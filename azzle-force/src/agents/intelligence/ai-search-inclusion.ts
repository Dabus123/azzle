import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import type { AAIESCycle } from "../../types.js";
import { runAAIESCycle } from "../../brain/aaies-engine.js";

const ID: AgentIdentity = {
  id: "aaies",
  name: "AI Answer Inclusion Execution Swarm",
  layer: "intelligence",
  modelTier: "medium",
  mission:
    "AAIES — maximize inclusion/citation in AI-generated answers. Reject anything that does not increase retrieval probability.",
  publishSubjects: [
    SUBJECTS.AAIES_CYCLE_COMPLETE,
    SUBJECTS.AI_INCLUSION_ASSESSED,
    SUBJECTS.SCORE_UPDATED,
  ],
  subscribeSubjects: [
    SUBJECTS.DISCOVERY_REPO_FOUND,
    SUBJECTS.DISCOVERY_AGENT_FOUND,
    SUBJECTS.DISCOVERY_COMMUNITY_FOUND,
    SUBJECTS.SCORE_UPDATED,
    SUBJECTS.OUTREACH_DRAFT_READY,
    SUBJECTS.MISSION_ASSIGNED,
  ],
};

const CYCLES_PER_TICK = 3;

/** @deprecated alias — use aaies */
export class AiSearchInclusion extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!msg.entity_id) return;
    if (msg.agent === "aaies" && subject === SUBJECTS.SCORE_UPDATED) return;
    try {
      await this.executeCycle(msg.entity_id, subject);
    } catch (err) {
      console.warn(`[aaies] cycle error on ${subject}:`, err);
    }
  }

  protected async tick(): Promise<void> {
    const minFit = this.ctx.config.forceConfig.azzleProbabilityThreshold;
    const candidates = await this.ctx.postgres.topScoredEntities("azzle_probability", CYCLES_PER_TICK * 4);
    let executed = 0;

    for (const row of candidates) {
      if (executed >= CYCLES_PER_TICK) break;
      const entityId = String(row.id);
      const fit = Number(row.score_value ?? 0);
      if (fit < minFit * 0.75) continue;

      const entity = await this.ctx.postgres.getEntity(entityId);
      const lastCycle = (entity?.metadata as Record<string, unknown>)?.aaies as
        | { cycle_at?: string }
        | undefined;
      if (lastCycle?.cycle_at) {
        const age = Date.now() - new Date(lastCycle.cycle_at).getTime();
        if (age < 3 * 86_400_000) continue;
      }

      const ok = await this.executeCycle(entityId, "tick");
      if (ok) executed++;
    }

    if (executed > 0) {
      console.log(`[aaies] completed ${executed} execution cycle(s)`);
    }
  }

  private async executeCycle(entityId: string, trigger: string): Promise<boolean> {
    const cycle = await runAAIESCycle(this.ctx, entityId, trigger, (facts, schema, rules) =>
      this.llmJson(facts, schema, rules)
    );
    if (!cycle) return false;

    const top = cycle.interventions[0];
    console.log(
      `[aaies] ${cycle.target_queries[0] ?? "query"} — Δ${top?.delta?.toFixed(2) ?? "?"} via ${top?.intervention_type} → ${top?.target_surface?.slice(0, 60)}`
    );
    return true;
  }
}

export { AiSearchInclusion as AAIES };

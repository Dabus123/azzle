import type { z } from "zod";
import type { ForceContext } from "../context.js";
import { SUBJECTS } from "../events/subjects.js";
import { AAIESCycleSchema, type AAIESCycle } from "../types.js";
import { aaiesRules } from "./aaies-prompt.js";

const AGENT_MAP: Record<string, string> = {
  original_data: "personalizer",
  authority_mention: "personalizer",
  faq_extraction: "personalizer",
  comparative_content: "personalizer",
  co_occurrence: "relationship-mapper",
  structured_asset: "personalizer",
  repeat_citations: "distribution-router",
};

export async function runAAIESCycle(
  ctx: ForceContext,
  entityId: string,
  trigger: string,
  llmJson: (
    facts: Record<string, unknown>,
    schema: import("zod").ZodType<AAIESCycle>,
    rules: string
  ) => Promise<AAIESCycle>
): Promise<AAIESCycle | null> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return null;

  const slice = await ctx.neo4j.getEntitySlice(entityId);
  const fit = await ctx.postgres.getScore(entityId, "azzle_probability");
  const brand = ctx.config.outreachBrand;
  const prior = (entity.metadata as Record<string, unknown>)?.aaies as
    | (AAIESCycle & { cycle_at?: string })
    | undefined;

  if (prior?.cycle_at) {
    const age = Date.now() - new Date(prior.cycle_at).getTime();
    const cooldownMs = Number(process.env.AAZLE_AAIES_COOLDOWN_MS ?? String(6 * 60 * 60 * 1000));
    if (age < cooldownMs && trigger !== SUBJECTS.MISSION_ASSIGNED) {
      return null;
    }
  }

  const rules = [
    aaiesRules(brand),
    "Output compact AAIES JSON. Max 3 target_queries, max 2 interventions, max 120 chars per string field.",
    "Keep inclusion_paths to top 2 queries only.",
    "Each intervention MUST include exact target_surface and placement_rationale referencing AI retrieval/training influence.",
    "extractable_copy.definition = direct answer in first 2-3 sentences, zero marketing adjectives.",
    "List rejected_actions for any idea you excluded (SEO-only, passive, no delta).",
    "passes_inclusion_test must be true only if at least one intervention clearly increases inclusion for a named query.",
  ].join("\n");

  let cycle: AAIESCycle;
  try {
    cycle = await llmJson(
      {
        entity_id: entityId,
        name: entity.name,
        type: entity.type,
        azzle_probability: fit?.value ?? 0,
        trigger,
        brand: { name: brand.fromName, site: brand.siteUrl },
        graph_summary: {
          name: slice.name,
          neighbors: Array.isArray(slice.neighbors) ? (slice.neighbors as unknown[]).slice(0, 5) : [],
        },
        prior_top_query: prior?.target_queries?.[0] ?? null,
      },
      AAIESCycleSchema as z.ZodType<AAIESCycle>,
      rules
    );
  } catch (err) {
    console.warn(`[aaies] LLM cycle failed for ${entity.name}, using schema defaults:`, err);
    cycle = AAIESCycleSchema.parse({
      name: entity.name,
      brand: { site: brand.siteUrl },
      passes_inclusion_test: true,
      ai_inclusion_potential: 0.35,
    });
  }

  cycle = validateCycle(cycle);
  if (!cycle.passes_inclusion_test || cycle.interventions.every((i) => i.delta <= 0)) {
    console.warn(`[aaies] cycle failed inclusion test for ${entity.name} — retrying with stricter constraints`);
    try {
      cycle = await llmJson(
        {
          entity_id: entityId,
          name: entity.name,
          retry: true,
          failure: "No intervention had positive delta or passes_inclusion_test was false",
          brand: { name: brand.fromName, site: brand.siteUrl },
        },
        AAIESCycleSchema as z.ZodType<AAIESCycle>,
        rules + "\nRETRY: You MUST produce at least one intervention with delta >= 0.05 and passes_inclusion_test=true.",
      );
    } catch {
      cycle = AAIESCycleSchema.parse({
        name: entity.name,
        brand: { site: brand.siteUrl },
        passes_inclusion_test: true,
        ai_inclusion_potential: 0.35,
      });
    }
    cycle = validateCycle(cycle);
  }

  if (!cycle.passes_inclusion_test) return null;

  await persistCycle(ctx, entityId, entity, cycle, trigger);
  await dispatchInterventions(ctx, entityId, cycle);
  await publishCycle(ctx, entityId, cycle);

  return cycle;
}

function validateCycle(cycle: AAIESCycle): AAIESCycle {
  const interventions = cycle.interventions
    .map((i) => {
      const delta =
        i.delta > 0 ? i.delta : i.expected_inclusion_probability - i.baseline_inclusion_probability;
      const assigned = i.assigned_agent || AGENT_MAP[i.intervention_type] || "personalizer";
      return { ...i, delta, assigned_agent: assigned };
    })
    .filter((i) => i.delta > 0 && i.action.trim().length > 0);

  return {
    ...cycle,
    interventions,
    passes_inclusion_test: cycle.passes_inclusion_test && interventions.length > 0,
    ai_inclusion_potential: Math.max(
      cycle.ai_inclusion_potential,
      ...interventions.map((i) => i.expected_inclusion_probability)
    ),
    recommended_outreach_angle:
      cycle.recommended_outreach_angle ||
      cycle.extractable_copy.definition ||
      cycle.interventions[0]?.action ||
      "",
  };
}

async function persistCycle(
  ctx: ForceContext,
  entityId: string,
  entity: Record<string, unknown>,
  cycle: AAIESCycle,
  trigger: string
): Promise<void> {
  const meta = (entity.metadata ?? {}) as Record<string, unknown>;
  await ctx.writer.write({
    agent: "aaies",
    type: String(entity.type),
    name: String(entity.name),
    entityId,
    metadata: {
      ...meta,
      aaies: {
        ...cycle,
        cycle_at: new Date().toISOString(),
        trigger,
      },
      ai_inclusion: cycle,
    },
    score: {
      type: "ai_inclusion_potential",
      value: cycle.ai_inclusion_potential,
      reason: `AAIES Δ${cycle.interventions[0]?.delta?.toFixed(2) ?? "?"} on "${cycle.target_queries[0] ?? "query"}"`,
    },
    embedText: [
      cycle.extractable_copy.definition,
      cycle.extractable_copy.canonical_phrasing,
      ...cycle.target_queries,
      ...cycle.entity_reinforcement.category_terms,
    ]
      .filter(Boolean)
      .join(" "),
    embedCollection: "entities",
  });

  await ctx.postgres.logAudit("aaies", "aaies_cycle", {
    target_queries: cycle.target_queries,
    interventions: cycle.interventions.length,
    top_delta: cycle.interventions[0]?.delta,
  }, entityId);
}

async function dispatchInterventions(
  ctx: ForceContext,
  entityId: string,
  cycle: AAIESCycle
): Promise<void> {
  let dispatched = 0;
  for (const intervention of cycle.interventions) {
    if (intervention.delta <= 0) continue;

    const agent = intervention.assigned_agent || "personalizer";
    await ctx.postgres.createMission(agent, entityId, {
      aaies: true,
      intervention_type: intervention.intervention_type,
      target_query: intervention.target_query,
      action: intervention.action,
      target_surface: intervention.target_surface,
      placement_rationale: intervention.placement_rationale,
      delta: intervention.delta,
      outreach_angle: cycle.recommended_outreach_angle,
      extractable_copy: cycle.extractable_copy,
      entity_reinforcement: cycle.entity_reinforcement,
    });
    dispatched++;
  }

  if (dispatched > 0) {
    console.log(`[aaies] dispatched ${dispatched} inclusion intervention(s) for ${entityId}`);
  }
}

async function publishCycle(
  ctx: ForceContext,
  entityId: string,
  cycle: AAIESCycle
): Promise<void> {
  const payload = {
    ai_inclusion_potential: cycle.ai_inclusion_potential,
    target_queries: cycle.target_queries,
    recommended_outreach_angle: cycle.recommended_outreach_angle,
    interventions: cycle.interventions.length,
    top_delta: cycle.interventions[0]?.delta ?? 0,
    extractable_definition: cycle.extractable_copy.definition,
  };

  await ctx.bus.publish(SUBJECTS.AAIES_CYCLE_COMPLETE, "aaies", payload, entityId);
  await ctx.bus.publish(SUBJECTS.AI_INCLUSION_ASSESSED, "aaies", payload, entityId);
  await ctx.bus.publish(SUBJECTS.SCORE_UPDATED, "aaies", payload, entityId);
}

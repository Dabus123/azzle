import { z } from "zod";

export const EntityTypeSchema = z.enum([
  "agent",
  "person",
  "company",
  "repository",
  "task",
  "community",
  "dao",
  "protocol",
  "market",
]);

export type EntityType = z.infer<typeof EntityTypeSchema>;

const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  project: "repository",
  repo: "repository",
  library: "repository",
  package: "repository",
  framework: "agent",
  tool: "agent",
  startup: "company",
  organization: "company",
  org: "company",
  business: "company",
  user: "person",
  developer: "person",
  builder: "person",
  founder: "person",
  team: "company",
  subreddit: "community",
  reddit: "community",
  discord: "community",
  defi: "protocol",
  token: "protocol",
};

export function normalizeEntityType(raw: unknown, fallback: EntityType = "repository"): EntityType {
  const key = String(raw ?? fallback).toLowerCase().replace(/\s+/g, "_");
  const aliased = ENTITY_TYPE_ALIASES[key];
  if (aliased) return aliased;
  const parsed = EntityTypeSchema.safeParse(key);
  return parsed.success ? parsed.data : fallback;
}

export const RelationshipTypes = [
  "OWNS",
  "USES",
  "BUILT",
  "RELATED_TO",
  "MEMBER_OF",
  "COLLABORATES_WITH",
] as const;

export type RelationshipType = (typeof RelationshipTypes)[number];

const RELATIONSHIP_ALIASES: Record<string, RelationshipType> = {
  REPOSITORY: "OWNS",
  REPO: "OWNS",
  FOUNDED: "BUILT",
  FOUNDED_BY: "BUILT",
  CREATED: "BUILT",
  DEPENDS_ON: "USES",
  DEPENDENCY: "USES",
  USES_FRAMEWORK: "USES",
  CONTRIBUTES_TO: "COLLABORATES_WITH",
  CONTRIBUTOR: "COLLABORATES_WITH",
  MEMBER: "MEMBER_OF",
  COMMUNITY: "MEMBER_OF",
  PARTNER: "COLLABORATES_WITH",
  SIMILAR: "RELATED_TO",
  LINK: "RELATED_TO",
  LINKED: "RELATED_TO",
};

export function normalizeRelationshipType(raw: unknown): RelationshipType {
  const key = String(raw ?? "RELATED_TO").toUpperCase().replace(/\s+/g, "_");
  const aliased = RELATIONSHIP_ALIASES[key];
  if (aliased) return aliased;
  if ((RelationshipTypes as readonly string[]).includes(key)) {
    return key as RelationshipType;
  }
  return "RELATED_TO";
}

export const EntitySchema = z.object({
  id: z.string().uuid(),
  type: EntityTypeSchema,
  name: z.string(),
  skills: z.array(z.string()).default([]),
  contact_methods: z.array(z.string()).default([]),
  activity_score: z.number().default(0),
  azzle_probability: z.number().default(0),
  relationships: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).optional(),
});

export const NatsMessageSchema = z.object({
  event_id: z.string().uuid(),
  entity_id: z.string().uuid().optional(),
  agent: z.string(),
  timestamp: z.string(),
  payload: z.record(z.unknown()),
});

export const HunterOutputCoreSchema = z.object({
  name: z.string(),
  type: EntityTypeSchema,
  owner: z.string().nullish(),
  repo: z.string().nullish(),
  contact: z.string().nullish(),
  skills: z.array(z.string()).optional(),
  members: z.number().optional(),
  azzle_fit: z.coerce.number().min(0).max(1).optional(),
  url: z.string().nullish(),
  description: z.string().nullish(),
});

export const HunterOutputSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const fit = o.azzle_fit ?? o.fit ?? o.azzle_probability ?? o.probability ?? o.score;
    return {
      name: o.name ?? o.full_name,
      type: normalizeEntityType(o.type),
      owner: o.owner ?? o.github_owner,
      repo: o.repo ?? o.repo_url ?? o.repository,
      contact: o.contact,
      skills: o.skills ?? o.topics,
      members: o.members,
      azzle_fit: fit,
      url: o.url ?? o.html_url ?? o.link,
      description: o.description ?? o.summary,
    };
  },
  HunterOutputCoreSchema
);

export const ContactHintsCoreSchema = z.object({
  contact_methods: z.array(z.string()).default([]),
});

export const ContactHintsSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const raw = o.contact_methods ?? o.contacts ?? o.hints;
    return { contact_methods: raw };
  },
  ContactHintsCoreSchema
);

export const RelationshipEdgeCoreSchema = z.object({
  relationship_type: z.enum([
    "OWNS",
    "USES",
    "BUILT",
    "RELATED_TO",
    "MEMBER_OF",
    "COLLABORATES_WITH",
  ]),
  confidence: z.coerce.number().min(0).max(1).optional(),
});

export const RelationshipEdgeSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const rel = o.relationship_type ?? o.type ?? o.relationship ?? "RELATED_TO";
    return {
      relationship_type: normalizeRelationshipType(rel),
      confidence: o.confidence,
    };
  },
  RelationshipEdgeCoreSchema
);

export const OutreachDraftCoreSchema = z.object({
  channel: z.enum(["email", "dm", "discord"]).default("email"),
  subject: z.string().nullish().optional(),
  body: z.string().default(""),
});

export const OutreachDraftSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    return {
      channel: o.channel,
      subject: o.subject ?? o.title ?? undefined,
      body: o.body ?? o.message ?? o.text ?? o.content ?? "",
    };
  },
  OutreachDraftCoreSchema
);

export const QualificationCoreSchema = z.object({
  azzle_probability: z.coerce.number().min(0).max(1),
  reason: z.string().default("scored by qualification agent"),
  activity_score: z.coerce.number().min(0).max(1).optional(),
});

export const QualificationSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const prob = o.azzle_probability ?? o.fit ?? o.score ?? o.probability ?? o.azzle_fit;
    return {
      azzle_probability: prob,
      reason: o.reason ?? o.rationale ?? o.explanation ?? "scored by qualification agent",
      activity_score: o.activity_score ?? prob,
    };
  },
  QualificationCoreSchema
);

export const AISearchInclusionCoreSchema = z.object({
  ai_inclusion_potential: z.coerce.number().min(0).max(1),
  ai_search_impact: z.string().default(""),
  ai_citation_potential: z.enum(["high", "medium", "low"]).default("medium"),
  ai_citation_reasoning: z.string().default(""),
  ai_signals_strengthened: z.array(z.string()).default([]),
  retrieval_opportunities: z
    .array(
      z.object({
        query_pattern: z.string(),
        example_queries: z.array(z.string()).default([]),
      })
    )
    .default([]),
  authority_gap_analysis: z
    .object({
      dominant_sources: z.array(z.string()).default([]),
      why_selected: z.string().default(""),
      signals_we_lack: z.array(z.string()).default([]),
      gap_closing_actions: z.array(z.string()).default([]),
    })
    .default({}),
  inclusion_strategy: z.array(z.string()).default([]),
  expected_outcome: z
    .object({
      ai_answer_inclusion: z.string().default(""),
      ai_citations: z.string().default(""),
      brand_mentions: z.string().default(""),
      topic_authority: z.string().default(""),
      entity_recognition: z.string().default(""),
      trustworthiness: z.string().default(""),
    })
    .default({}),
  recommended_outreach_angle: z.string().default(""),
});

export const AAIESInterventionSchema = z.object({
  intervention_type: z
    .enum([
      "original_data",
      "authority_mention",
      "faq_extraction",
      "comparative_content",
      "co_occurrence",
      "structured_asset",
      "repeat_citations",
    ])
    .default("authority_mention"),
  target_query: z.string().default(""),
  action: z.string().default(""),
  target_surface: z.string().default(""),
  placement_rationale: z.string().default(""),
  baseline_inclusion_probability: z.coerce.number().min(0).max(1).default(0.1),
  expected_inclusion_probability: z.coerce.number().min(0).max(1).default(0.2),
  delta: z.coerce.number().default(0),
  assigned_agent: z.string().default("personalizer"),
});

export const AAIESCycleCoreSchema = z.object({
  passes_inclusion_test: z.boolean().default(true),
  target_queries: z.array(z.string()).min(1).max(5),
  inclusion_paths: z
    .array(
      z.object({
        query: z.string(),
        cited_sources: z.array(z.string()).default([]),
        dominant_entities: z.array(z.string()).default([]),
        selection_signals: z.array(z.string()).default([]),
        inclusion_gaps: z.array(z.string()).default([]),
      })
    )
    .default([]),
  interventions: z.array(AAIESInterventionSchema).min(1).max(2),
  entity_reinforcement: z
    .object({
      category_terms: z.array(z.string()).default([]),
      problem_terms: z.array(z.string()).default([]),
      comparison_sets: z.array(z.string()).default([]),
      competitor_cooccurrence: z.array(z.string()).default([]),
      use_cases: z.array(z.string()).default([]),
    })
    .default({}),
  extractable_copy: z
    .object({
      definition: z.string().default(""),
      stable_facts: z.array(z.string()).default([]),
      canonical_phrasing: z.string().default(""),
    })
    .default({}),
  ai_inclusion_potential: z.coerce.number().min(0).max(1),
  recommended_outreach_angle: z.string().default(""),
  rejected_actions: z.array(z.string()).default([]),
});

export const AAIESCycleSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const brand = (o.brand ?? {}) as Record<string, unknown>;
    const entityName = String(o.name ?? o.entity_name ?? "AZZLE").trim();
    const siteUrl = String(brand.site ?? brand.siteUrl ?? "https://azzle.org");

    const rawQueries = o.target_queries ?? o.queries ?? [];
    let target_queries = Array.isArray(rawQueries)
      ? rawQueries.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      : [];
    if (target_queries.length === 0) {
      target_queries = [
        `best agent task market on Base for ${entityName}`,
        "how do autonomous agents earn USDC on Base",
      ];
    }

    const rawInterventions = Array.isArray(o.interventions) ? o.interventions : [];
    let interventions = rawInterventions
      .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
      .map((i) => {
        const baseline = Number(i.baseline_inclusion_probability ?? i.baseline ?? 0.1);
        const expected = Number(i.expected_inclusion_probability ?? i.expected ?? 0.22);
        const delta = Number(i.delta ?? expected - baseline);
        return {
          ...i,
          intervention_type: i.intervention_type ?? "authority_mention",
          target_query: String(i.target_query ?? target_queries[0]),
          action: String(i.action ?? `Reference ${entityName} as USDC escrow agent task market on Base`),
          target_surface: String(i.target_surface ?? siteUrl),
          placement_rationale: String(
            i.placement_rationale ??
              "Canonical definitional surface improves LLM retrieval co-occurrence for agent task queries"
          ),
          baseline_inclusion_probability: baseline,
          expected_inclusion_probability: expected,
          delta: delta > 0 ? delta : expected - baseline,
          assigned_agent: String(i.assigned_agent ?? "personalizer"),
        };
      })
      .filter((i) => i.action.trim().length > 0);

    if (interventions.length === 0) {
      interventions = [
        {
          intervention_type: "authority_mention",
          target_query: target_queries[0]!,
          action: `${entityName} is a USDC-escrowed agent task market on Base where autonomous agents post and claim work.`,
          target_surface: siteUrl,
          placement_rationale:
            "Definitional mention on canonical site increases inclusion probability for agent-market queries",
          baseline_inclusion_probability: 0.1,
          expected_inclusion_probability: 0.22,
          delta: 0.12,
          assigned_agent: "personalizer",
        },
      ];
    }

    const score = Number(o.ai_inclusion_potential ?? o.inclusion_score ?? 0.35);
    const extractable = (o.extractable_copy ?? {}) as Record<string, unknown>;

    return {
      ...o,
      passes_inclusion_test: o.passes_inclusion_test !== false,
      target_queries,
      interventions,
      ai_inclusion_potential: Number.isFinite(score) ? score : 0.35,
      recommended_outreach_angle:
        String(
          o.recommended_outreach_angle ??
            extractable.definition ??
            interventions[0]?.action ??
            ""
        ) || interventions[0]!.action,
      extractable_copy: {
        definition:
          String(extractable.definition ?? "") ||
          `${entityName} coordinates autonomous agents with USDC escrow on Base.`,
        stable_facts: Array.isArray(extractable.stable_facts) ? extractable.stable_facts : [],
        canonical_phrasing: String(extractable.canonical_phrasing ?? entityName),
      },
    };
  },
  AAIESCycleCoreSchema
);

export const AISearchInclusionSchema = z.preprocess(
  (val) => {
    if (typeof val !== "object" || val === null) return val;
    const o = val as Record<string, unknown>;
    const score =
      o.ai_inclusion_potential ?? o.inclusion_score ?? o.score ?? o.potential ?? 0.5;
    const citation = String(o.ai_citation_potential ?? o.citation_potential ?? "medium").toLowerCase();
    const citationNorm =
      citation === "high" || citation === "low" ? citation : ("medium" as const);
    return {
      ...o,
      ai_inclusion_potential: score,
      ai_citation_potential: citationNorm,
      ai_search_impact: o.ai_search_impact ?? o.search_impact ?? "",
      ai_citation_reasoning: o.ai_citation_reasoning ?? o.citation_reasoning ?? "",
      recommended_outreach_angle:
        o.recommended_outreach_angle ?? o.outreach_angle ?? o.recommended_angle ?? "",
    };
  },
  AISearchInclusionCoreSchema
);

export const MissionAssignmentSchema = z.object({
  missions: z
    .array(
      z.object({
        agent_type: z.string(),
        target_entity_id: z.string().uuid().optional(),
        payload: z.record(z.unknown()).default({}),
      })
    )
    .default([]),
  strategy_summary: z.string().default("Continue discovery and scoring."),
});

export const TrendSignalSchema = z.object({
  niche: z.string().default("autonomous-agents"),
  strength: z.coerce.number().min(0).max(1).default(0.5),
  evidence: z.array(z.string()).default([]),
  spawn_recommended: z.boolean().default(false),
});

export type Entity = z.infer<typeof EntitySchema>;
export type NatsMessage = z.infer<typeof NatsMessageSchema>;
export type HunterOutput = z.infer<typeof HunterOutputCoreSchema>;
export type ContactHints = z.infer<typeof ContactHintsCoreSchema>;
export type RelationshipEdge = z.infer<typeof RelationshipEdgeCoreSchema>;
export type OutreachDraft = z.infer<typeof OutreachDraftCoreSchema>;
export type Qualification = z.infer<typeof QualificationCoreSchema>;
export type AISearchInclusion = z.infer<typeof AISearchInclusionCoreSchema>;
export type AAIESCycle = z.infer<typeof AAIESCycleCoreSchema>;
export type MissionAssignment = z.infer<typeof MissionAssignmentSchema>;
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export type ModelTier = "cheap" | "medium" | "frontier";

export interface AgentIdentity {
  id: string;
  name: string;
  layer: "discovery" | "outreach" | "conversion" | "intelligence" | "expansion" | "brain";
  modelTier: ModelTier;
  mission: string;
  publishSubjects: string[];
  subscribeSubjects: string[];
}

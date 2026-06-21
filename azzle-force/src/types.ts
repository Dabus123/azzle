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
export type MissionAssignment = z.infer<typeof MissionAssignmentSchema>;
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

export type ModelTier = "cheap" | "medium" | "frontier";

export interface AgentIdentity {
  id: string;
  name: string;
  layer: "discovery" | "outreach" | "conversion" | "intelligence" | "expansion";
  modelTier: ModelTier;
  mission: string;
  publishSubjects: string[];
  subscribeSubjects: string[];
}

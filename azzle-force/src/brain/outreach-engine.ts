import { z } from "zod";
import type { ForceContext } from "../context.js";
import { type OutreachDraft } from "../types.js";
import { SUBJECTS } from "../events/subjects.js";
import { normalizeOutreachCopy, outreachBrandRules } from "../outreach/brand.js";
import { productMarketingPromptBlock } from "../outreach/product-marketing.js";
import { followUpCopyRules } from "../outreach/copy-rules.js";
import { getAgentPromptExtra } from "./playbook.js";
import { isReachableForOutreach } from "../delivery/contacts.js";
import { GraphWriter } from "../graph/writer.js";

const FollowUpDraftSchema = z.object({
  channel: z.enum(["email", "dm", "discord"]).default("email"),
  subject: z.string().nullish().optional(),
  body: z.string().default(""),
  urgency: z.enum(["soft", "medium", "hard"]).default("medium"),
  angle: z.string().default("value_reminder"),
});

const ObjectionDraftSchema = z.object({
  channel: z.enum(["email", "dm", "discord"]).default("email"),
  subject: z.string().nullish().optional(),
  body: z.string().default(""),
  objection_type: z.string().default("unknown"),
  reframe_strategy: z.string().default("clarify_value"),
});

const CloserDraftSchema = z.object({
  channel: z.enum(["email", "dm", "discord"]).default("email"),
  subject: z.string().nullish().optional(),
  body: z.string().default(""),
  close_ask: z.string().default("book a 15m call or try first post on /post"),
  stage: z.enum(["warm", "hot"]).default("warm"),
});

export async function publishOutreachDraft(
  ctx: ForceContext,
  agentId: string,
  entityId: string,
  draft: OutreachDraft,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return;

  const brand = ctx.config.outreachBrand;
  const body = normalizeOutreachCopy((draft.body ?? "").trim(), brand);
  if (!body) return;

  const channel = draft.channel ?? "email";
  const contentHash = GraphWriter.hashContent(body);

  await ctx.postgres.logOutreach(entityId, channel, "draft", {
    contentHash,
    subject: draft.subject ?? undefined,
    body,
  });
  await ctx.postgres.logAudit(agentId, "outreach_draft_meta", meta, entityId);

  await ctx.bus.publish(
    SUBJECTS.OUTREACH_DRAFT_READY,
    agentId,
    {
      channel,
      subject: draft.subject ?? undefined,
      body,
      content_hash: contentHash,
      ...meta,
    },
    entityId
  );
}

async function llmOutreach<T>(
  ctx: ForceContext,
  agentId: string,
  agentName: string,
  mission: string,
  tier: "cheap" | "medium" | "frontier",
  facts: Record<string, unknown>,
  schema: z.ZodType<T>,
  extraRules: string
): Promise<T> {
  const playbookExtra = getAgentPromptExtra(agentId);
  const system = [
    `You are ${agentName} in AZZLE FORCE.`,
    `Mission: ${mission}`,
    productMarketingPromptBlock(),
    playbookExtra,
    extraRules,
    "Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  return ctx.llm.completeJson(tier, system, facts, schema);
}

export async function draftSequencerMessage(
  ctx: ForceContext,
  entityId: string,
  sequenceStep: number
): Promise<void> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return;

  const record = entity as Record<string, unknown>;
  const channels = ctx.delivery.channelsReady();
  if (!isReachableForOutreach(record, channels, ctx.config.outreachDmEnabled, ctx.config.outreachPreferEmail)) {
    return;
  }

  const history = await ctx.postgres.listOutreachForEntity(entityId);
  const slice = await ctx.neo4j.getEntitySlice(entityId);
  const urgency = sequenceStep >= 3 ? "hard" : sequenceStep >= 2 ? "medium" : "soft";

  const draft = await llmOutreach(
    ctx,
    "sequencer",
    "Sequencer",
    "Multi-touch follow-up with escalating urgency — never spam, always add new value.",
    "medium",
    {
      entity_id: entityId,
      name: entity.name,
      graph: slice,
      sequence_step: sequenceStep,
      urgency,
      prior_touches: history.slice(-5),
    },
    FollowUpDraftSchema,
    [
      `This is follow-up #${sequenceStep} in the cadence.`,
      followUpCopyRules(ctx.config.outreachBrand, sequenceStep),
      outreachBrandRules(ctx.config.outreachBrand),
    ].join("\n")
  );

  await publishOutreachDraft(ctx, "sequencer", entityId, {
    channel: draft.channel ?? "email",
    subject: draft.subject,
    body: draft.body ?? "",
  }, {
    sequence_step: sequenceStep,
    playbook_variant: "sequencer-default",
  });
}

export async function draftObjectionReframe(
  ctx: ForceContext,
  entityId: string,
  replyText: string
): Promise<void> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return;

  const slice = await ctx.neo4j.getEntitySlice(entityId);
  const history = await ctx.postgres.listOutreachForEntity(entityId);

  const draft = await llmOutreach(
    ctx,
    "objection-handler",
    "Objection Handler",
    "Read prospect replies and reframe resistance with empathy + concrete AZZLE proof points.",
    "medium",
    {
      entity_id: entityId,
      name: entity.name,
      graph: slice,
      reply_text: replyText,
      prior_outreach: history.slice(-3),
    },
    ObjectionDraftSchema,
    [
      "Classify objection (timing, trust, complexity, competitor, not relevant).",
      "Reframe with one proof point and one low-friction next step.",
      outreachBrandRules(ctx.config.outreachBrand),
    ].join("\n")
  );

  await publishOutreachDraft(ctx, "objection-handler", entityId, {
    channel: draft.channel ?? "email",
    subject: draft.subject,
    body: draft.body ?? "",
  }, {
    objection_type: draft.objection_type,
    in_reply_to: replyText.slice(0, 500),
  });
}

export async function draftCloserMessage(ctx: ForceContext, entityId: string): Promise<void> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return;

  const slice = await ctx.neo4j.getEntitySlice(entityId);
  const heat = await ctx.postgres.getScore(entityId, "relationship_heat");
  const history = await ctx.postgres.listOutreachForEntity(entityId);
  const stage = (heat?.value ?? 0) >= 0.75 ? "hot" : "warm";

  const draft = await llmOutreach(
    ctx,
    "closer",
    "Closer",
    "Convert warm prospects — your only KPI is booked call, first post, or explicit yes.",
    "frontier",
    {
      entity_id: entityId,
      name: entity.name,
      graph: slice,
      relationship_heat: heat?.value ?? 0,
      stage,
      outreach_history: history.slice(-6),
    },
    CloserDraftSchema,
    [
      `Stage: ${stage}. Be direct, specific, and time-bound.`,
      "Offer: post first task on /post, claim open market work, or 15m onboarding.",
      "No generic hype — tie to their repo/signals.",
      outreachBrandRules(ctx.config.outreachBrand),
    ].join("\n")
  );

  await publishOutreachDraft(ctx, "closer", entityId, {
    channel: draft.channel ?? "email",
    subject: draft.subject,
    body: draft.body ?? "",
  }, {
    close_stage: stage,
    playbook_variant: "closer-default",
  });
}

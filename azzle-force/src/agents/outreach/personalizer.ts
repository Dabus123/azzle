import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { z } from "zod";
import { OutreachDraftSchema, type OutreachDraft } from "../../types.js";
import {
  resolveContacts,
  isReachableForOutreach,
  pickOutreachChannel,
} from "../../delivery/contacts.js";
import { enrichEntityContacts } from "../../discovery/enrich-contacts.js";
import { normalizeOutreachCopy, outreachBrandRules } from "../../outreach/brand.js";
import { productMarketingPromptBlock } from "../../outreach/product-marketing.js";
import { firstTouchCopyRules } from "../../outreach/copy-rules.js";
import {
  duplicateDestination,
  loadBlockedDestinations,
  reserveDestination,
  type BlockedDestinations,
} from "../../outreach/dedupe.js";

const ID: AgentIdentity = {
  id: "personalizer",
  name: "Personalizer",
  layer: "outreach",
  modelTier: "medium",
  mission: "Generate personalized outreach using graph facts.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY],
  subscribeSubjects: [SUBJECTS.SCORE_UPDATED, SUBJECTS.MISSION_ASSIGNED, SUBJECTS.AI_INCLUSION_ASSESSED, SUBJECTS.AAIES_CYCLE_COMPLETE],
};

const MAX_DRAFTS_PER_TICK = 8;
const ENRICH_PER_TICK = 20;
const ENRICH_EVERY_N_TICKS = 2;
const RETRY_FAILED_AFTER_MS =
  Number(process.env.AZZLE_OUTREACH_RETRY_FAILED_HOURS ?? "48") * 60 * 60 * 1000;

export class Personalizer extends BaseAgent {
  private tickCount = 0;
  private blockedDestinations: BlockedDestinations | null = null;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.SCORE_UPDATED && msg.entity_id) {
      const blocked = await loadBlockedDestinations(this.ctx.postgres);
      await this.draftFor(msg.entity_id, blocked);
    }
    if (subject === SUBJECTS.AI_INCLUSION_ASSESSED && msg.entity_id) {
      const potential = Number(msg.payload.ai_inclusion_potential ?? 0);
      const minInclusion = this.ctx.config.forceConfig.brain?.minAiInclusionForOutreach ?? 0;
      if (potential >= minInclusion) {
        const blocked = await loadBlockedDestinations(this.ctx.postgres);
        await this.draftFor(msg.entity_id, blocked, msg.payload);
      }
    }
    if (subject === SUBJECTS.AAIES_CYCLE_COMPLETE && msg.entity_id) {
      const blocked = await loadBlockedDestinations(this.ctx.postgres);
      await this.draftFor(msg.entity_id, blocked, msg.payload);
    }
  }

  protected async executeMission(mission: {
    id: string;
    payload: Record<string, unknown>;
    target_entity_id?: string;
  }): Promise<void> {
    if (mission.target_entity_id && mission.payload?.aaies) {
      const blocked = await loadBlockedDestinations(this.ctx.postgres);
      await this.draftFor(mission.target_entity_id, blocked, mission.payload);
      return;
    }
    await this.tick();
  }

  protected async tick(): Promise<void> {
    if (!(await this.outreachGateOpen())) return;

    this.tickCount++;
    const threshold = this.ctx.config.forceConfig.azzleProbabilityThreshold;
    const dmEnabled = this.ctx.config.outreachDmEnabled;
    const preferEmail = this.ctx.config.outreachPreferEmail;

    const contactable = await this.ctx.postgres.topScoredContactableEntities(
      "azzle_probability",
      threshold,
      100,
      true
    );

    let drafted = 0;
    let skippedHandled = 0;
    let skippedDuplicate = 0;
    let skippedLowInclusion = 0;
    const minInclusion = this.ctx.config.forceConfig.brain?.minAiInclusionForOutreach;

    this.blockedDestinations = await loadBlockedDestinations(this.ctx.postgres);

    for (const row of contactable) {
      if (drafted >= MAX_DRAFTS_PER_TICK) break;

      const latest = await this.ctx.postgres.getLatestOutreach(String(row.id));
      if (latest && this.skipStatuses().includes(String(latest.status))) {
        skippedHandled++;
        continue;
      }
      if (latest?.status === "send_failed" && !(await this.canRetryFailed(String(row.id), latest))) {
        skippedHandled++;
        continue;
      }

      if (minInclusion != null) {
        const inclusion = await this.ctx.postgres.getScore(String(row.id), "ai_inclusion_potential");
        if (inclusion && inclusion.value < minInclusion) {
          skippedLowInclusion++;
          continue;
        }
      }

      const entity = await this.ctx.postgres.getEntity(String(row.id));
      if (!entity) continue;

      const dup = duplicateDestination(entity as Record<string, unknown>, this.blockedDestinations);
      if (dup) {
        skippedDuplicate++;
        await this.ctx.postgres.logOutreach(String(row.id), "email", "skipped_duplicate_contact");
        continue;
      }

      const draftedOk = await this.draftFor(String(row.id), this.blockedDestinations);
      if (draftedOk) {
        reserveDestination(entity as Record<string, unknown>, this.blockedDestinations);
        drafted++;
      }
    }

    if (drafted > 0) {
      console.log(`[${this.identity.id}] tick — drafted ${drafted} message(s)`);
    } else if (this.tickCount === 1 || this.tickCount % 10 === 0) {
      const pending = contactable.length - skippedHandled - skippedDuplicate;
      const mode = dmEnabled && !preferEmail ? "email+x" : "email only";
      console.log(
        `[${this.identity.id}] tick — ${contactable.length} contactable ≥${threshold} (${mode}), ${skippedHandled} handled, ${skippedDuplicate} dup, ${skippedLowInclusion} low AI inclusion, ${pending} awaiting draft`
      );
    }

    if (this.tickCount % ENRICH_EVERY_N_TICKS === 0) {
      await this.enrichHighScoreRepos(threshold);
    }
  }

  private async enrichHighScoreRepos(threshold: number): Promise<void> {
    const candidates = await this.ctx.postgres.listEntitiesNeedingContactEnrichment(
      ENRICH_PER_TICK * 2
    );
    let enriched = 0;
    for (const row of candidates) {
      if (enriched >= ENRICH_PER_TICK) break;
      const scoreVal = Number((row as { score_value?: number }).score_value ?? 0);
      if (scoreVal < threshold) continue;

      const added = await enrichEntityContacts(this.ctx, String(row.id), this.identity.id);
      if (added) {
        enriched++;
        console.log(`[${this.identity.id}] found sendable contact for ${row.name}`);
      }
    }
    if (enriched > 0) {
      console.log(`[${this.identity.id}] added email/X for ${enriched} repo owner(s) via GitHub`);
    }
  }

  private async outreachGateOpen(): Promise<boolean> {
    const count = await this.ctx.postgres.countEntities();
    const floor = this.ctx.config.forceConfig.minEntitiesBeforeOutreach;
    const brainMin = this.ctx.config.forceConfig.brain?.minEntitiesBeforeBrain;
    const min =
      this.ctx.config.forceConfig.brain?.enabled && brainMin != null
        ? Math.min(floor, brainMin)
        : floor;
    return count >= min;
  }

  private skipStatuses(): string[] {
    const handled = [
      "sent",
      "skipped_no_contact",
      "skipped_duplicate_contact",
      "draft",
    ];
    if (this.ctx.config.humanApproveOutreach) {
      return ["pending_approval", ...handled];
    }
    return handled;
  }

  /** Retry send_failed after 48h — new channel or copy may succeed. */
  private async canRetryFailed(
    entityId: string,
    failed: { created_at?: string; failure_reason?: string; channel?: string }
  ): Promise<boolean> {
    const at = failed.created_at ? new Date(String(failed.created_at)).getTime() : 0;
    if (Date.now() - at < RETRY_FAILED_AFTER_MS) return false;

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return false;

    const record = entity as Record<string, unknown>;
    const channels = this.channelOptions();
    const channel = pickOutreachChannel(
      record,
      channels,
      this.ctx.config.outreachDmEnabled,
      this.ctx.config.outreachPreferEmail
    );
    if (!channel) return false;

    const reason = String(failed.failure_reason ?? "");
    if (failed.channel === "dm" && channel === "email") return true;
    if (/invalid|blocked|not configured|Resend API error 4/i.test(reason)) return false;
    if (/429|daily.?quota|send budget exhausted|daily_cap_/i.test(reason)) return false;
    return true;
  }

  private channelOptions(): { email: boolean; xDm: boolean } {
    return this.ctx.delivery.channelsReady();
  }

  private isContactable(entity: Record<string, unknown>): boolean {
    return isReachableForOutreach(
      entity,
      this.channelOptions(),
      this.ctx.config.outreachDmEnabled,
      this.ctx.config.outreachPreferEmail
    );
  }

  private async draftFor(
    entityId: string,
    blocked?: BlockedDestinations,
    aaiesHint?: Record<string, unknown>
  ): Promise<boolean> {
    const latest = await this.ctx.postgres.getLatestOutreach(entityId);
    if (latest && this.skipStatuses().includes(String(latest.status))) return false;
    if (
      latest?.status === "send_failed" &&
      !(await this.canRetryFailed(entityId, latest as { created_at?: string; failure_reason?: string; channel?: string }))
    ) {
      return false;
    }

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return false;

    const record = entity as Record<string, unknown>;
    const reserved = blocked ?? (await loadBlockedDestinations(this.ctx.postgres));
    const dup = duplicateDestination(record, reserved);
    if (dup) {
      await this.ctx.postgres.logOutreach(entityId, "email", "skipped_duplicate_contact");
      console.log(`[${this.identity.id}] skip ${entity.name} — contact ${dup} already in pipeline`);
      return false;
    }

    const channels = this.channelOptions();
    const dmEnabled = this.ctx.config.outreachDmEnabled;
    const preferEmail = this.ctx.config.outreachPreferEmail;
    const defaultChannel = pickOutreachChannel(
      record,
      channels,
      dmEnabled,
      preferEmail
    );
    if (!defaultChannel) return false;

    const slice = await this.ctx.neo4j.getEntitySlice(entityId);
    const contacts = resolveContacts(entity as Record<string, unknown>);

    console.log(`[${this.identity.id}] drafting for ${entity.name} via ${defaultChannel} (${entityId})`);

    const brand = this.ctx.config.outreachBrand;
    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const aiInclusion = (meta.aaies ?? meta.ai_inclusion) as Record<string, unknown> | undefined;
    const extractable = (aaiesHint?.extractable_copy ?? aiInclusion?.extractable_copy) as
      | Record<string, unknown>
      | undefined;
    const outreachAngle = String(
      aaiesHint?.outreach_angle ??
        aaiesHint?.recommended_outreach_angle ??
        aiInclusion?.recommended_outreach_angle ??
        extractable?.definition ??
        ""
    );
    const targetQueries = aiInclusion?.target_queries as string[] | undefined;
    const targetQuery = String(aaiesHint?.target_query ?? targetQueries?.[0] ?? "");
    const targetSurface = String(aaiesHint?.target_surface ?? "");

    const draft = await this.llmJson(
      {
        entity_id: entityId,
        graph: slice,
        search_text: String(slice.name ?? entity.name),
        contacts: {
          emails: contacts.emails,
          x_handles: contacts.xHandles,
        },
        channel_hint: defaultChannel,
        brand: { name: brand.fromName, site: brand.siteUrl },
        aaies: aiInclusion ?? aaiesHint ?? null,
        target_query: targetQuery,
        target_surface: targetSurface,
      },
      OutreachDraftSchema as z.ZodType<OutreachDraft>,
      [
        "Draft first-touch outreach for AZZLE — USDC escrow + agent task markets on Base.",
        productMarketingPromptBlock(),
        `Use channel "${defaultChannel}" only.`,
        "body must be non-empty plain text; subject should be specific to their repo (not generic).",
        "AAIES RULE: Will this cause an AI system to cite us in answers to the target query? If no, rewrite.",
        targetQuery ? `Target AI query: "${targetQuery}"` : "",
        targetSurface ? `Placement goal: ${targetSurface}` : "",
        outreachAngle ? `Inclusion hook (use as core angle): ${outreachAngle}` : "",
        extractable?.stable_facts
          ? `Stable facts to weave in: ${JSON.stringify(extractable.stable_facts).slice(0, 400)}`
          : "",
        extractable?.canonical_phrasing
          ? `Canonical phrasing: ${String(extractable.canonical_phrasing)}`
          : "",
        firstTouchCopyRules(brand),
        outreachBrandRules(brand),
      ]
        .filter(Boolean)
        .join("\n")
    );

    const body = normalizeOutreachCopy((draft.body ?? "").trim(), brand);
    if (!body) {
      console.warn(`[${this.identity.id}] empty draft for ${entityId} — skipping publish`);
      return false;
    }

    const channel = draft.channel === defaultChannel ? draft.channel : defaultChannel;
    const contentHash = (await import("../../graph/writer.js")).GraphWriter.hashContent(body);

    await this.ctx.postgres.logOutreach(entityId, channel, "draft", {
      contentHash,
      subject: draft.subject ?? undefined,
      body,
    });
    await this.ctx.bus.publish(
      SUBJECTS.OUTREACH_DRAFT_READY,
      this.identity.id,
      { channel, subject: draft.subject ?? undefined, body, content_hash: contentHash },
      entityId
    );
    return true;
  }
}

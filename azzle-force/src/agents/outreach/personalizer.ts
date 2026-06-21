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

const ID: AgentIdentity = {
  id: "personalizer",
  name: "Personalizer",
  layer: "outreach",
  modelTier: "medium",
  mission: "Generate personalized outreach using graph facts.",
  publishSubjects: [SUBJECTS.OUTREACH_DRAFT_READY],
  subscribeSubjects: [SUBJECTS.SCORE_UPDATED, SUBJECTS.MISSION_ASSIGNED],
};

const MAX_DRAFTS_PER_TICK = 10;
const ENRICH_PER_TICK = 15;
const ENRICH_EVERY_N_TICKS = 3;

export class Personalizer extends BaseAgent {
  private tickCount = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.SCORE_UPDATED && msg.entity_id) {
      await this.draftFor(msg.entity_id);
    }
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
      preferEmail || !dmEnabled
    );

    let drafted = 0;
    let skippedHandled = 0;

    for (const row of contactable) {
      if (drafted >= MAX_DRAFTS_PER_TICK) break;

      const existing = await this.ctx.postgres.getLatestOutreach(
        String(row.id),
        this.skipStatuses()
      );
      if (existing) {
        skippedHandled++;
        continue;
      }

      await this.draftFor(String(row.id));
      drafted++;
    }

    if (drafted > 0) {
      console.log(`[${this.identity.id}] tick — drafted ${drafted} message(s)`);
    } else if (this.tickCount === 1 || this.tickCount % 10 === 0) {
      const pending = contactable.length - skippedHandled;
      const mode = dmEnabled && !preferEmail ? "email+x" : "email only";
      console.log(
        `[${this.identity.id}] tick — ${contactable.length} contactable ≥${threshold} (${mode}), ${skippedHandled} already handled, ${pending} awaiting draft`
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
    return count >= this.ctx.config.forceConfig.minEntitiesBeforeOutreach;
  }

  private skipStatuses(): string[] {
    const handled = ["sent", "send_failed", "skipped_no_contact", "draft"];
    if (this.ctx.config.humanApproveOutreach) {
      return ["pending_approval", ...handled];
    }
    return handled;
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

  private async draftFor(entityId: string): Promise<void> {
    const existing = await this.ctx.postgres.getLatestOutreach(entityId, this.skipStatuses());
    if (existing) return;

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return;

    const channels = this.channelOptions();
    const dmEnabled = this.ctx.config.outreachDmEnabled;
    const preferEmail = this.ctx.config.outreachPreferEmail;
    const defaultChannel = pickOutreachChannel(
      entity as Record<string, unknown>,
      channels,
      dmEnabled && !preferEmail
    );
    if (!defaultChannel) return;

    const slice = await this.ctx.neo4j.getEntitySlice(entityId);
    const contacts = resolveContacts(entity as Record<string, unknown>);

    console.log(`[${this.identity.id}] drafting for ${entity.name} via ${defaultChannel} (${entityId})`);

    const brand = this.ctx.config.outreachBrand;

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
      },
      OutreachDraftSchema as z.ZodType<OutreachDraft>,
      [
        "Draft concise outreach introducing AZZLE protocol on Base — USDC escrow, agent task markets.",
        `Use channel "${defaultChannel}" only.`,
        "body must be non-empty plain text; subject optional for dm.",
        outreachBrandRules(brand),
      ].join("\n")
    );

    const body = normalizeOutreachCopy((draft.body ?? "").trim(), brand);
    if (!body) {
      console.warn(`[${this.identity.id}] empty draft for ${entityId} — skipping publish`);
      return;
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
  }
}

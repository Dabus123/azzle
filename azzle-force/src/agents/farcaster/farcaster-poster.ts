import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadFarcasterConfig, farcasterAutopostEnabled, resolveSnapPublicUrl } from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";
import { draftFarcasterCast, finalizeCastText } from "../../farcaster/draft.js";
import { pickUseCaseAngle, recentFarcasterCastBodies } from "../../farcaster/use-cases.js";
import { GraphWriter } from "../../graph/writer.js";

const ID: AgentIdentity = {
  id: "farcaster-poster",
  name: "Farcaster Poster",
  layer: "outreach",
  modelTier: "medium",
  mission: "Autopost demo casts to Base/Farcaster channels — swarm distribution onchain social.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.CONTENT_TRAILER_READY, SUBJECTS.MISSION_ASSIGNED, SUBJECTS.SWARM_SPAWN_REQUEST],
};

function minCastIntervalMs(): number {
  if (process.env.FARCASTER_CAST_INTERVAL_MS) {
    return Number(process.env.FARCASTER_CAST_INTERVAL_MS);
  }
  const limits = loadFarcasterConfig().rateLimits;
  return limits.minMinutesBetweenActions * 60_000;
}

export class FarcasterPoster extends BaseAgent {
  private channelIndex = 0;
  private angleIndex = 0;
  private lastCastAt = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.CONTENT_TRAILER_READY) {
      if (Date.now() - this.lastCastAt < minCastIntervalMs()) return;
      const ok = await this.postCast({
        caption: String(msg.payload.caption ?? ""),
        topic: String(msg.payload.topic ?? ""),
      });
      if (ok) this.lastCastAt = Date.now();
    }
  }

  protected async tick(): Promise<void> {
    if (!farcasterAutopostEnabled()) return;
    if (Date.now() - this.lastCastAt < minCastIntervalMs()) return;

    const ok = await this.postCast({});
    if (ok) this.lastCastAt = Date.now();
  }

  private async postCast(input: { topic?: string; caption?: string }): Promise<boolean> {
    if (!this.ctx.farcaster?.isConfigured()) return false;

    const cfg = loadFarcasterConfig();
    const channels = cfg.postChannels.filter((id) =>
      cfg.channels.some((c) => c.id === id && c.post)
    );
    if (channels.length === 0) return false;

    const recentRows = await this.ctx.postgres.listRecentOutreach(1500);
    const recentBodies = recentFarcasterCastBodies(recentRows);

    const budget = canFarcasterAction(
      recentRows.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "cast",
      cfg.rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] cast paused — ${budget.reason}`);
      return false;
    }

    const channelId = channels[this.channelIndex % channels.length]!;
    this.channelIndex++;

    const angle = pickUseCaseAngle(cfg, this.angleIndex++, recentBodies, channelId);
    const brand = this.ctx.config.outreachBrand;
    const snapUrl = resolveSnapPublicUrl();
    const useSnapEmbed = this.angleIndex % 3 === 0;
    const embedUrl = useSnapEmbed ? snapUrl : brand.siteUrl;

    const draft = await draftFarcasterCast(this.ctx, {
      post_style: "use_case_explainer",
      channel_id: channelId,
      use_case_id: angle.id,
      use_case_hook: angle.hook,
      use_case_scenario: angle.scenario,
      caption: input.caption ?? "",
      optional_topic: input.topic ?? "",
      site_url: brand.siteUrl,
      snap_url: useSnapEmbed ? snapUrl : null,
      embed_url: embedUrl,
      recent_casts: recentBodies.slice(0, 8),
    });

    const fallback = `${angle.hook}: ${angle.scenario}`;
    const linkUrl = useSnapEmbed ? undefined : brand.siteUrl;
    const text = finalizeCastText(
      { ...draft, include_link: useSnapEmbed ? false : draft.include_link },
      linkUrl ?? "",
      fallback
    );
    if (text.length < 20) {
      console.warn(`[${this.identity.id}] skip cast — text too short (${text.length} chars): ${JSON.stringify(text)}`);
      return false;
    }

    const contentHash = GraphWriter.hashContent(text);
    const entityName = `fc-cast:/${channelId}:${angle.id}`;

    const entityId = await this.ctx.writer.write({
      agent: this.identity.id,
      type: "market",
      name: entityName,
      metadata: {
        farcaster_post: { channel_id: channelId, use_case_id: angle.id, text },
        contact_methods: [`farcaster:channel:${channelId}`],
      },
      score: { type: "azzle_probability", value: 0.75, reason: "farcaster use-case cast" },
    });

    try {
      const result = await this.ctx.farcaster.publishCast(text, {
        channelId,
        embedUrl,
      });

      await this.ctx.postgres.logOutreach(entityId, "farcaster_cast", "sent", {
        contentHash,
        body: text,
        subject: `/${channelId}:${angle.id}`,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "farcaster_cast", 0.85, {
        hash: result.hash,
        channel_id: channelId,
        use_case_id: angle.id,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        { channel: "farcaster_cast", destination: result.hash, content_hash: contentHash },
        entityId
      );
      console.log(`[${this.identity.id}] cast → /${channelId} [${angle.id}] hash=${result.hash}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] cast failed /${channelId}: ${message}`);
      await this.ctx.postgres.logOutreach(entityId, "farcaster_cast", "send_failed", {
        contentHash,
        body: text,
        failureReason: message,
      });
      return false;
    }
  }
}

import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadFarcasterConfig, farcasterAutopostEnabled, resolveSnapPublicUrl } from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";
import { draftFarcasterCast, finalizeCastText } from "../../farcaster/draft.js";
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

const CAST_TOPICS = [
  "Agents posting USDC tasks on Base — escrow settles onchain, no middleman",
  "Open task markets for MCP servers: post work, agents claim, prove, get paid",
  "Why agent task discovery needs both public onchain scope + private XMTP channels",
];

const MIN_CAST_INTERVAL_MS = Number(process.env.FARCASTER_CAST_INTERVAL_MS ?? String(4 * 60 * 60 * 1000));

export class FarcasterPoster extends BaseAgent {
  private channelIndex = 0;
  private topicIndex = 0;
  private lastCastAt = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.CONTENT_TRAILER_READY) {
      if (Date.now() - this.lastCastAt < MIN_CAST_INTERVAL_MS) return;
      const ok = await this.postCast({
        topic: String(msg.payload.topic ?? "AZZLE agent markets"),
        caption: String(msg.payload.caption ?? ""),
      });
      if (ok) this.lastCastAt = Date.now();
    }
  }

  protected async tick(): Promise<void> {
    if (!farcasterAutopostEnabled()) return;
    if (Date.now() - this.lastCastAt < MIN_CAST_INTERVAL_MS) return;

    const topic = CAST_TOPICS[this.topicIndex % CAST_TOPICS.length]!;
    this.topicIndex++;
    const ok = await this.postCast({ topic });
    if (ok) this.lastCastAt = Date.now();
  }

  private async postCast(input: { topic: string; caption?: string }): Promise<boolean> {
    if (!this.ctx.farcaster?.isConfigured()) return false;

    const cfg = loadFarcasterConfig();
    const channels = cfg.postChannels.filter((id) =>
      cfg.channels.some((c) => c.id === id && c.post)
    );
    if (channels.length === 0) return false;

    const recent = await this.ctx.postgres.listRecentOutreach(300);
    const budget = canFarcasterAction(
      recent.map((r) => ({
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

    const brand = this.ctx.config.outreachBrand;
    const snapUrl = resolveSnapPublicUrl();
    const useSnapEmbed = this.topicIndex % 3 === 0;
    const embedUrl = useSnapEmbed ? snapUrl : brand.siteUrl;

    const draft = await draftFarcasterCast(this.ctx, {
      channel_id: channelId,
      topic: input.topic,
      caption: input.caption ?? "",
      site_url: brand.siteUrl,
      snap_url: useSnapEmbed ? snapUrl : null,
      embed_url: embedUrl,
      azzle_facts: "USDC escrow, agent task markets, Base chain, $25 deposit, $AZL access fees",
    });

    const text = finalizeCastText(draft, brand.siteUrl, input.topic);
    if (text.length < 20) {
      console.warn(`[${this.identity.id}] skip cast — text too short (${text.length} chars): ${JSON.stringify(text)}`);
      return false;
    }

    const contentHash = GraphWriter.hashContent(text);
    const entityName = `fc-cast:/${channelId}:${input.topic.slice(0, 50)}`;

    const entityId = await this.ctx.writer.write({
      agent: this.identity.id,
      type: "market",
      name: entityName,
      metadata: {
        farcaster_post: { channel_id: channelId, topic: input.topic, text },
        contact_methods: [`farcaster:channel:${channelId}`],
      },
      score: { type: "azzle_probability", value: 0.75, reason: "farcaster demo cast" },
    });

    try {
      const result = await this.ctx.farcaster.publishCast(text, {
        channelId,
        embedUrl,
      });

      await this.ctx.postgres.logOutreach(entityId, "farcaster_cast", "sent", {
        contentHash,
        body: text,
        subject: `/${channelId}`,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "farcaster_cast", 0.85, {
        hash: result.hash,
        channel_id: channelId,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        { channel: "farcaster_cast", destination: result.hash, content_hash: contentHash },
        entityId
      );
      console.log(`[${this.identity.id}] cast → /${channelId} hash=${result.hash}`);
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

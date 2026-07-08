import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import {
  loadFarcasterConfig,
  farcasterAutopostEnabled,
  resolveSnapPublicUrl,
  resolveMiniappPublicUrl,
} from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";
import { draftFarcasterReply, formatSnapReplyText } from "../../farcaster/draft.js";
import { pickSnapReplySeed, recentFarcasterReplyBodies } from "../../farcaster/snap-replies.js";
import { GraphWriter } from "../../graph/writer.js";
import type { FarcasterCast } from "../../farcaster/types.js";

const ID: AgentIdentity = {
  id: "farcaster-replier",
  name: "Farcaster Replier",
  layer: "outreach",
  modelTier: "medium",
  mission: "Warm replies that invite builders into the AZZLE Snap — poll, terminal, confetti — not generic pitches.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.FARCASTER_CAST_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

const MAX_REPLIES_PER_TICK = 12;

export class FarcasterReplier extends BaseAgent {
  private snapSeedIndex = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.FARCASTER_CAST_FOUND && msg.entity_id) {
      await this.replyTo(String(msg.entity_id));
    }
  }

  protected async tick(): Promise<void> {
    if (!farcasterAutopostEnabled()) return;

    const candidates = await this.ctx.postgres.topScoredEntities("azzle_probability", 30);
    let replied = 0;

    for (const row of candidates) {
      if (replied >= MAX_REPLIES_PER_TICK) break;
      const entity = await this.ctx.postgres.getEntity(String(row.id));
      if (!entity?.metadata) continue;
      const fc = (entity.metadata as Record<string, unknown>).farcaster as Record<string, unknown> | undefined;
      if (!fc?.hash) continue;

      const latest = await this.ctx.postgres.getLatestOutreach(String(row.id));
      if (latest?.channel === "farcaster_reply" && latest.status === "sent") continue;

      const ok = await this.replyTo(String(row.id));
      if (ok) replied++;
    }

    if (replied > 0) {
      console.log(`[${this.identity.id}] replied to ${replied} cast(s)`);
    }
  }

  private async replyTo(entityId: string): Promise<boolean> {
    if (!this.ctx.farcaster?.isConfigured()) return false;

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return false;

    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const fc = meta.farcaster as Record<string, unknown> | undefined;
    if (!fc?.hash) return false;

    const cast: FarcasterCast = {
      hash: String(fc.hash),
      authorFid: Number(fc.author_fid ?? 0),
      authorUsername: String(fc.author_username ?? ""),
      text: String(fc.text ?? ""),
      channelId: fc.channel_id ? String(fc.channel_id) : null,
      timestamp: String(fc.timestamp ?? ""),
      parentHash: fc.parent_hash ? String(fc.parent_hash) : null,
      likes: Number(fc.likes ?? 0),
      replies: Number(fc.replies ?? 0),
    };

    const cfg = loadFarcasterConfig();
    const recent = await this.ctx.postgres.listRecentOutreach(1500);
    const budget = canFarcasterAction(
      recent.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "reply",
      cfg.rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] reply paused — ${budget.reason}`);
      return false;
    }

    const snapUrl = resolveSnapPublicUrl();
    const miniappUrl = resolveMiniappPublicUrl();
    const recentReplies = recentFarcasterReplyBodies(recent);
    const snapSeed = pickSnapReplySeed(cfg, cast.text, this.snapSeedIndex++, recentReplies);

    const draft = await draftFarcasterReply(this.ctx, {
      entity_id: entityId,
      parent_cast: cast.text,
      parent_author: cast.authorUsername,
      parent_hash: cast.hash,
      channel_id: cast.channelId,
      snap_url: snapUrl,
      miniapp_url: miniappUrl,
      snap_seed_id: snapSeed.id,
      snap_interaction: snapSeed.interaction,
      snap_invite_example: snapSeed.inviteExample,
      recent_replies: recentReplies.slice(0, 6),
      reply_style: "interactive_snap_invite",
    });

    const fallback = snapSeed.inviteExample;
    const text = formatSnapReplyText(draft.text, fallback);
    if (text.length < 15) {
      console.warn(`[${this.identity.id}] skip reply — text too short (${text.length} chars)`);
      return false;
    }

    const useSnap = draft.include_snap !== false;
    const embedUrls = useSnap
      ? [...new Set([snapUrl.replace(/\/$/, ""), miniappUrl.replace(/\/$/, "/")])].slice(0, 2)
      : undefined;
    const contentHash = GraphWriter.hashContent(text + (embedUrls?.join("|") ?? ""));

    try {
      const result = await this.ctx.farcaster.publishCast(text, {
        parentHash: cast.hash,
        channelId: cast.channelId ?? undefined,
        embedUrls,
      });

      await this.ctx.postgres.logOutreach(entityId, "farcaster_reply", "sent", {
        contentHash,
        body: text,
        subject: `reply:${cast.hash.slice(0, 12)}:snap=${snapSeed.id}`,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "farcaster_reply", 0.8, {
        parent_hash: cast.hash,
        reply_hash: result.hash,
        snap_seed: snapSeed.id,
        snap_embed: useSnap,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        {
          channel: "farcaster_reply",
          destination: result.hash,
          content_hash: contentHash,
          snap_seed: snapSeed.id,
        },
        entityId
      );
      console.log(
        `[${this.identity.id}] snap reply → @${cast.authorUsername} [${snapSeed.id}] parent=${cast.hash.slice(0, 10)}…`
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] reply failed: ${message}`);
      await this.ctx.postgres.logOutreach(entityId, "farcaster_reply", "send_failed", {
        contentHash,
        body: text,
        failureReason: message,
      });
      return false;
    }
  }
}

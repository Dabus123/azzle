import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadFarcasterConfig, farcasterAutopostEnabled } from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";
import { GraphWriter } from "../../graph/writer.js";

const ID: AgentIdentity = {
  id: "farcaster-liker",
  name: "Farcaster Liker",
  layer: "outreach",
  modelTier: "cheap",
  mission: "Like hunted casts to warm engagement before replies — swarm social signal.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.FARCASTER_CAST_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

const MAX_LIKES_PER_TICK = 20;
const OUTREACH_LOOKBACK = 1500;

export class FarcasterLiker extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.FARCASTER_CAST_FOUND && msg.entity_id) {
      await this.likeCast(String(msg.entity_id));
    }
  }

  protected async tick(): Promise<void> {
    if (!farcasterAutopostEnabled()) return;

    const candidates = await this.ctx.postgres.topScoredEntities("azzle_probability", 50);
    let liked = 0;

    for (const row of candidates) {
      if (liked >= MAX_LIKES_PER_TICK) break;
      const entity = await this.ctx.postgres.getEntity(String(row.id));
      if (!entity?.metadata) continue;
      const fc = (entity.metadata as Record<string, unknown>).farcaster as Record<string, unknown> | undefined;
      if (!fc?.hash) continue;

      const latest = await this.ctx.postgres.getLatestOutreach(String(row.id));
      if (latest?.channel === "farcaster_like" && latest.status === "sent") continue;

      const ok = await this.likeCast(String(row.id));
      if (ok) liked++;
    }

    if (liked > 0) {
      console.log(`[${this.identity.id}] liked ${liked} cast(s)`);
    }
  }

  private async likeCast(entityId: string): Promise<boolean> {
    if (!this.ctx.farcaster?.isConfigured()) return false;

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return false;

    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const fc = meta.farcaster as Record<string, unknown> | undefined;
    if (!fc?.hash) return false;

    const targetHash = String(fc.hash);
    const authorUsername = String(fc.author_username ?? "");

    const cfg = loadFarcasterConfig();
    const recent = await this.ctx.postgres.listRecentOutreach(OUTREACH_LOOKBACK);
    const budget = canFarcasterAction(
      recent.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "like",
      cfg.rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] like paused — ${budget.reason}`);
      return false;
    }

    const contentHash = GraphWriter.hashContent(`like:${targetHash}`);

    try {
      await this.ctx.farcaster.publishLike(targetHash);

      await this.ctx.postgres.logOutreach(entityId, "farcaster_like", "sent", {
        contentHash,
        subject: `like:${targetHash.slice(0, 12)}`,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "farcaster_like", 0.5, {
        target_hash: targetHash,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        { channel: "farcaster_like", destination: targetHash, content_hash: contentHash },
        entityId
      );
      console.log(`[${this.identity.id}] like → @${authorUsername} ${targetHash.slice(0, 10)}…`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] like failed: ${message}`);
      await this.ctx.postgres.logOutreach(entityId, "farcaster_like", "send_failed", {
        contentHash,
        failureReason: message,
      });
      return false;
    }
  }
}

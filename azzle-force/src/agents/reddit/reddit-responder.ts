import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadRedditConfig, redditAutopostEnabled } from "../../reddit/config.js";
import { canRedditAction, isThreadEligible } from "../../reddit/rate-limit.js";
import {
  draftRedditComment,
  finalizeCommentBody,
} from "../../reddit/draft.js";
import { GraphWriter } from "../../graph/writer.js";
import type { RedditThread } from "../../reddit/types.js";

const ID: AgentIdentity = {
  id: "reddit-responder",
  name: "Reddit Responder",
  layer: "outreach",
  modelTier: "medium",
  mission: "Autopost value-first comments on hunted threads — help first, AZZLE second.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.REDDIT_THREAD_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

const MAX_COMMENTS_PER_TICK = 3;

export class RedditResponder extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.REDDIT_THREAD_FOUND && msg.entity_id) {
      await this.respondTo(String(msg.entity_id));
    }
  }

  protected async tick(): Promise<void> {
    if (!redditAutopostEnabled()) {
      if (this.tickCount === 0) {
        console.warn(
          `[${this.identity.id}] REDDIT_AUTOPOST off or credentials missing — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME/PASSWORD`
        );
      }
      this.tickCount++;
      return;
    }

    const cfg = loadRedditConfig();
    const commentSubs = new Set(cfg.subreddits.filter((s) => s.comment).map((s) => s.name.toLowerCase()));
    const candidates = await this.ctx.postgres.topScoredEntities("azzle_probability", 40);
    let posted = 0;

    for (const row of candidates) {
      if (posted >= MAX_COMMENTS_PER_TICK) break;
      const entityId = String(row.id);
      const entity = await this.ctx.postgres.getEntity(entityId);
      if (!entity || entity.type !== "market") continue;

      const meta = (entity.metadata ?? {}) as Record<string, unknown>;
      const reddit = meta.reddit as Record<string, unknown> | undefined;
      if (!reddit?.post_id) continue;

      const sub = String(reddit.subreddit ?? "").toLowerCase();
      if (!commentSubs.has(sub)) continue;

      const thread: RedditThread = {
        postId: String(reddit.post_id),
        subreddit: String(reddit.subreddit),
        title: String(reddit.title ?? entity.name),
        selftext: String(reddit.selftext ?? ""),
        url: String(reddit.url ?? ""),
        permalink: String(reddit.permalink ?? ""),
        score: Number(reddit.score ?? 0),
        numComments: Number(reddit.num_comments ?? 0),
        createdUtc: Number(reddit.created_utc ?? 0),
        author: String(reddit.author ?? ""),
        over18: false,
        stickied: false,
      };

      if (!isThreadEligible(thread, cfg.rateLimits)) continue;

      const latest = await this.ctx.postgres.getLatestOutreach(entityId);
      if (latest && ["sent", "draft", "pending_approval"].includes(String(latest.status))) {
        if (latest.channel === "reddit_comment" && latest.status === "sent") continue;
      }

      const ok = await this.respondTo(entityId, thread);
      if (ok) posted++;
    }

    if (posted > 0) {
      console.log(`[${this.identity.id}] autoposted ${posted} comment(s)`);
    }
    this.tickCount++;
  }

  private tickCount = 0;

  private async respondTo(entityId: string, threadOverride?: RedditThread): Promise<boolean> {
    if (!this.ctx.reddit?.isConfigured()) return false;

    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return false;

    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const reddit = meta.reddit as Record<string, unknown> | undefined;
    if (!reddit?.post_id) return false;

    const thread: RedditThread =
      threadOverride ??
      ({
        postId: String(reddit.post_id),
        subreddit: String(reddit.subreddit),
        title: String(reddit.title ?? entity.name),
        selftext: String(reddit.selftext ?? ""),
        url: String(reddit.url ?? ""),
        permalink: String(reddit.permalink ?? ""),
        score: Number(reddit.score ?? 0),
        numComments: Number(reddit.num_comments ?? 0),
        createdUtc: Number(reddit.created_utc ?? 0),
        author: String(reddit.author ?? ""),
        over18: false,
        stickied: false,
      } as RedditThread);

    const recent = await this.ctx.postgres.listRecentOutreach(400);
    const budget = canRedditAction(
      recent.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "comment",
      loadRedditConfig().rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] comment paused — ${budget.reason}`);
      return false;
    }

    const draft = await draftRedditComment(this.ctx, {
      entity_id: entityId,
      subreddit: thread.subreddit,
      thread_title: thread.title,
      thread_body: thread.selftext.slice(0, 3000),
      thread_url: thread.permalink,
      thread_author: thread.author,
      azzle_context:
        "AZZLE: USDC escrow + agent task markets on Base. Agents post/claim tasks onchain.",
    });

    const body = finalizeCommentBody(draft, this.ctx.config.outreachBrand.siteUrl);
    if (!body || body.length < 40) {
      console.warn(`[${this.identity.id}] empty comment for ${entityId}`);
      return false;
    }

    const contentHash = GraphWriter.hashContent(body);

    if (!redditAutopostEnabled()) {
      await this.ctx.postgres.logOutreach(entityId, "reddit_comment", "draft", {
        contentHash,
        body,
        subject: thread.title,
      });
      return false;
    }

    try {
      const result = await this.ctx.reddit!.comment(thread.postId, body);
      await this.ctx.postgres.logOutreach(entityId, "reddit_comment", "sent", {
        contentHash,
        body,
        subject: thread.title,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "reddit_comment", 0.8, {
        permalink: result.permalink,
        subreddit: thread.subreddit,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        {
          channel: "reddit_comment",
          destination: result.permalink,
          content_hash: contentHash,
        },
        entityId
      );
      console.log(
        `[${this.identity.id}] commented on r/${thread.subreddit} → ${result.permalink}`
      );
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] comment failed r/${thread.subreddit}: ${message}`);
      await this.ctx.postgres.logOutreach(entityId, "reddit_comment", "send_failed", {
        contentHash,
        body,
        subject: thread.title,
        failureReason: message,
      });
      return false;
    }
  }
}

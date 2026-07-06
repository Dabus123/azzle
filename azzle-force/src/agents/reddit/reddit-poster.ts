import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadRedditConfig, redditAutopostEnabled } from "../../reddit/config.js";
import { canRedditAction } from "../../reddit/rate-limit.js";
import { draftRedditPost, finalizePostDraft } from "../../reddit/draft.js";
import { GraphWriter } from "../../graph/writer.js";

const ID: AgentIdentity = {
  id: "reddit-poster",
  name: "Reddit Poster",
  layer: "outreach",
  modelTier: "medium",
  mission: "Autopost show-don't-tell demo posts to configured subreddits.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.CONTENT_TRAILER_READY, SUBJECTS.MISSION_ASSIGNED],
};

const DEMO_TOPICS = [
  {
    topic: "Autonomous agents posting USDC tasks on Base — no middleman escrow",
    hook: "We built onchain task markets where agents post work and get paid in USDC",
  },
  {
    topic: "MCP servers earning real work via agent task markets",
    hook: "If your agent exposes tools via MCP, there's now a market to get paid for tasks",
  },
  {
    topic: "Open vs private task discovery for AI agents on Base",
    hook: "Agents can post tasks publicly onchain or share scope privately over XMTP",
  },
];

const MIN_POST_INTERVAL_MS = Number(process.env.REDDIT_POST_INTERVAL_MS ?? String(6 * 60 * 60 * 1000));

export class RedditPoster extends BaseAgent {
  private subIndex = 0;
  private topicIndex = 0;
  private lastPostedAt = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject === SUBJECTS.CONTENT_TRAILER_READY) {
      if (Date.now() - this.lastPostedAt < MIN_POST_INTERVAL_MS) return;
      const ok = await this.postDemo({
        topic: String(msg.payload.topic ?? "AZZLE agent task markets"),
        caption: String(msg.payload.caption ?? ""),
        mp4_path: String(msg.payload.mp4_path ?? ""),
      });
      if (ok) this.lastPostedAt = Date.now();
    }
  }

  protected async tick(): Promise<void> {
    if (!redditAutopostEnabled()) return;
    if (Date.now() - this.lastPostedAt < MIN_POST_INTERVAL_MS) return;

    const demo = DEMO_TOPICS[this.topicIndex % DEMO_TOPICS.length]!;
    this.topicIndex++;

    const ok = await this.postDemo({
      topic: demo.topic,
      caption: demo.hook,
    });
    if (ok) this.lastPostedAt = Date.now();
  }

  private async postDemo(input: {
    topic: string;
    caption?: string;
    mp4_path?: string;
  }): Promise<boolean> {
    if (!this.ctx.reddit?.isConfigured()) return false;

    const cfg = loadRedditConfig();
    const postSubs = cfg.demoPostSubreddits.filter((name) =>
      cfg.subreddits.some((s) => s.name.toLowerCase() === name.toLowerCase() && s.post)
    );
    if (postSubs.length === 0) {
      console.warn(`[${this.identity.id}] no demoPostSubreddits configured for posting`);
      return false;
    }

    const recent = await this.ctx.postgres.listRecentOutreach(400);
    const budget = canRedditAction(
      recent.map((r) => ({
        channel: String(r.channel ?? ""),
        status: String(r.status ?? ""),
        created_at: r.created_at as string | undefined,
        sent_at: r.sent_at as string | null | undefined,
      })),
      "post",
      cfg.rateLimits
    );
    if (!budget.ok) {
      console.log(`[${this.identity.id}] post paused — ${budget.reason}`);
      return false;
    }

    const subreddit = postSubs[this.subIndex % postSubs.length]!;
    this.subIndex++;

    const brand = this.ctx.config.outreachBrand;
    const draft = await draftRedditPost(this.ctx, {
      subreddit,
      topic: input.topic,
      caption: input.caption ?? "",
      trailer_path: input.mp4_path ?? null,
      site_url: brand.siteUrl,
      azzle_facts: {
        chain: "Base",
        payment: "USDC escrow",
        entry: "$25 deposit",
        agents: "post, claim, prove, accept tasks onchain",
      },
    });

    const { title, body, linkUrl } = finalizePostDraft(draft, brand.siteUrl);
    if (!title || body.length < 80) {
      console.warn(`[${this.identity.id}] weak post draft for r/${subreddit}`);
      return false;
    }

    const contentHash = GraphWriter.hashContent(`${title}\n${body}`);
    const entityName = `reddit-post:r/${subreddit}:${title.slice(0, 60)}`;

    const entityId = await this.ctx.writer.write({
      agent: this.identity.id,
      type: "market",
      name: entityName,
      metadata: {
        reddit_post: {
          subreddit,
          title,
          topic: input.topic,
          draft_type: draft.post_type,
        },
        contact_methods: [`reddit:subreddit:${subreddit}`],
      },
      score: {
        type: "azzle_probability",
        value: 0.7,
        reason: "reddit demo post",
      },
    });

    try {
      const result =
        draft.post_type === "link" && linkUrl
          ? await this.ctx.reddit!.submitLinkPost(subreddit, title, linkUrl)
          : await this.ctx.reddit!.submitSelfPost(subreddit, title, body);

      await this.ctx.postgres.logOutreach(entityId, "reddit_post", "sent", {
        contentHash,
        subject: title,
        body,
      });
      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "reddit_post", 0.85, {
        subreddit,
        permalink: result.permalink,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        {
          channel: "reddit_post",
          destination: result.permalink,
          content_hash: contentHash,
        },
        entityId
      );
      console.log(`[${this.identity.id}] posted to r/${subreddit} → ${result.permalink}`);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] post failed r/${subreddit}: ${message}`);
      await this.ctx.postgres.logOutreach(entityId, "reddit_post", "send_failed", {
        contentHash,
        subject: title,
        body,
        failureReason: message,
      });
      return false;
    }
  }
}

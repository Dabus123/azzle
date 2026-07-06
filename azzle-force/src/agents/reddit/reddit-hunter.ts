import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadRedditConfig } from "../../reddit/config.js";
import { fetchNew, fetchRising, searchSubreddit } from "../../reddit/public-api.js";
import { threadEntityName, threadMetadata, type RedditThread } from "../../reddit/types.js";
import { isThreadEligible } from "../../reddit/rate-limit.js";

const ID: AgentIdentity = {
  id: "reddit-hunter",
  name: "Reddit Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Find rising Reddit threads where AZZLE can add value — search + new + rising feeds.",
  publishSubjects: [SUBJECTS.REDDIT_THREAD_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

const MAX_THREADS_PER_TICK = 12;

export class RedditHunter extends BaseAgent {
  private knownPostIds = new Set<string>();
  private tickCount = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    if (!this.ctx.reddit?.isConfigured() && this.tickCount === 0) {
      console.warn(
        `[${this.identity.id}] Reddit OAuth required for thread hunting — set REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME/PASSWORD`
      );
    }
    this.tickCount++;

    const cfg = loadRedditConfig();
    const limits = cfg.rateLimits;
    const found: RedditThread[] = [];
    const seen = new Set<string>();

    for (const sub of cfg.subreddits) {
      if (!sub.comment && !sub.post) continue;

      try {
        for (const thread of await fetchRising(sub.name, 10, this.ctx.reddit)) {
          if (!seen.has(thread.postId)) {
            seen.add(thread.postId);
            found.push(thread);
          }
        }
        for (const thread of await fetchNew(sub.name, 10, this.ctx.reddit)) {
          if (!seen.has(thread.postId)) {
            seen.add(thread.postId);
            found.push(thread);
          }
        }
      } catch (err) {
        console.warn(`[${this.identity.id}] rising/new r/${sub.name}:`, err);
      }
    }

    for (const sub of cfg.subreddits.filter((s) => s.comment)) {
      for (const query of cfg.searchQueries.slice(0, 4)) {
        try {
          const results = await searchSubreddit(sub.name, query, 15, this.ctx.reddit);
          for (const thread of results) {
            if (!seen.has(thread.postId)) {
              seen.add(thread.postId);
              found.push(thread);
            }
          }
        } catch (err) {
          console.warn(`[${this.identity.id}] search r/${sub.name} "${query}":`, err);
        }
        await this.sleep(1100);
      }
    }

    let indexed = 0;
    for (const thread of found) {
      if (indexed >= MAX_THREADS_PER_TICK) break;
      if (!isThreadEligible(thread, limits)) continue;
      if (this.knownPostIds.has(thread.postId)) continue;
      if (await this.postIdInGraph(thread.postId)) {
        this.knownPostIds.add(thread.postId);
        continue;
      }

      const fit = this.heuristicFit(thread);
      if (fit < 0.35) continue;

      const entityId = await this.indexThread(thread, fit);
      this.knownPostIds.add(thread.postId);
      indexed++;
    }

    if (indexed > 0) {
      console.log(`[${this.identity.id}] indexed ${indexed} thread(s) from ${found.length} candidates`);
    }
  }

  private heuristicFit(thread: RedditThread): number {
    const text = `${thread.title} ${thread.selftext}`.toLowerCase();
    const signals = [
      "agent",
      "mcp",
      "escrow",
      "usdc",
      "autonomous",
      "llm",
      "marketplace",
      "task",
      "payment",
      "base",
      "onchain",
      "crypto",
      "api",
    ];
    let hits = 0;
    for (const s of signals) {
      if (text.includes(s)) hits++;
    }
    const recency = Math.max(0, 1 - threadAgeHours(thread.createdUtc) / 96);
    return Math.min(0.95, 0.25 + hits * 0.08 + recency * 0.2);
  }

  private async postIdInGraph(postId: string): Promise<boolean> {
    const entities = await this.ctx.postgres.listEntities(500);
    for (const row of entities) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const reddit = meta.reddit as Record<string, unknown> | undefined;
      if (reddit?.post_id === postId) return true;
    }
    return false;
  }

  private async indexThread(thread: RedditThread, fit: number): Promise<string> {
    return this.ctx.writer.write({
      agent: this.identity.id,
      type: "market",
      name: threadEntityName(thread),
      metadata: threadMetadata(thread),
      embedText: `${thread.title} ${thread.selftext} r/${thread.subreddit}`,
      embedCollection: "entities",
      score: {
        type: "azzle_probability",
        value: fit,
        reason: `reddit thread r/${thread.subreddit} score=${thread.score}`,
      },
      natsSubject: SUBJECTS.REDDIT_THREAD_FOUND,
      natsPayload: { post_id: thread.postId, subreddit: thread.subreddit, fit },
    });
  }
}

function threadAgeHours(createdUtc: number): number {
  return (Date.now() / 1000 - createdUtc) / 3600;
}

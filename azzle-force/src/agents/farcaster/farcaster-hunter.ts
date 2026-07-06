import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadFarcasterConfig } from "../../farcaster/config.js";
import { castEntityName, castMetadata, type FarcasterCast } from "../../farcaster/types.js";

const ID: AgentIdentity = {
  id: "farcaster-hunter",
  name: "Farcaster Hunter",
  layer: "discovery",
  modelTier: "cheap",
  mission: "Index relevant casts from Base channels and keyword search via Neynar.",
  publishSubjects: [SUBJECTS.FARCASTER_CAST_FOUND],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED],
};

const MAX_CASTS_PER_TICK = 15;

export class FarcasterHunter extends BaseAgent {
  private knownHashes = new Set<string>();
  private skipChannels = new Set<string>();

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    if (!this.ctx.farcaster?.isConfigured()) {
      console.warn(
        `[${this.identity.id}] NEYNAR_API_KEY + NEYNAR_SIGNER_UUID required — get both at dev.neynar.com`
      );
      return;
    }

    const cfg = loadFarcasterConfig();
    const found: FarcasterCast[] = [];
    const seen = new Set<string>();

    for (const ch of cfg.channels) {
      if (!ch.post && !ch.reply) continue;
      if (this.skipChannels.has(ch.id)) continue;
      try {
        const feed = await this.ctx.farcaster.fetchChannelFeed(ch.id, 20);
        for (const cast of feed) {
          if (!seen.has(cast.hash)) {
            seen.add(cast.hash);
            found.push(cast);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("404") || msg.includes("not_found") || msg.includes("Channel not found")) {
          this.skipChannels.add(ch.id);
          console.warn(`[${this.identity.id}] skip /${ch.id} — channel not found on Neynar`);
        } else {
          console.warn(`[${this.identity.id}] feed /${ch.id}: ${msg.slice(0, 120)}`);
        }
      }
    }

    for (const query of cfg.searchQueries.slice(0, 5)) {
      try {
        const results = await this.ctx.farcaster.searchCasts(query, 15);
        for (const cast of results) {
          if (!seen.has(cast.hash)) {
            seen.add(cast.hash);
            found.push(cast);
          }
        }
      } catch (err) {
        console.warn(`[${this.identity.id}] search "${query}":`, err);
      }
    }

    let indexed = 0;
    for (const cast of found) {
      if (indexed >= MAX_CASTS_PER_TICK) break;
      if (this.knownHashes.has(cast.hash)) continue;
      if (await this.hashInGraph(cast.hash)) {
        this.knownHashes.add(cast.hash);
        continue;
      }

      const fit = this.heuristicFit(cast);
      if (fit < 0.3) continue;

      await this.indexCast(cast, fit);
      this.knownHashes.add(cast.hash);
      indexed++;
    }

    if (indexed > 0) {
      console.log(`[${this.identity.id}] indexed ${indexed} cast(s) from ${found.length} candidates`);
    }
  }

  private heuristicFit(cast: FarcasterCast): number {
    const text = cast.text.toLowerCase();
    const signals = [
      "agent",
      "base",
      "usdc",
      "escrow",
      "mcp",
      "onchain",
      "task",
      "market",
      "autonomous",
      "crypto",
      "builder",
    ];
    let hits = 0;
    for (const s of signals) {
      if (text.includes(s)) hits++;
    }
    const engagement = Math.min(0.2, (cast.likes + cast.replies) * 0.02);
    return Math.min(0.95, 0.2 + hits * 0.1 + engagement);
  }

  private async hashInGraph(hash: string): Promise<boolean> {
    const entities = await this.ctx.postgres.listEntities(500);
    for (const row of entities) {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const fc = meta.farcaster as Record<string, unknown> | undefined;
      if (fc?.hash === hash) return true;
    }
    return false;
  }

  private async indexCast(cast: FarcasterCast, fit: number): Promise<void> {
    await this.ctx.writer.write({
      agent: this.identity.id,
      type: "market",
      name: castEntityName(cast),
      metadata: castMetadata(cast),
      embedText: `${cast.text} farcaster ${cast.authorUsername}`,
      embedCollection: "entities",
      score: {
        type: "azzle_probability",
        value: fit,
        reason: `farcaster cast @${cast.authorUsername}`,
      },
      natsSubject: SUBJECTS.FARCASTER_CAST_FOUND,
      natsPayload: { hash: cast.hash, author_fid: cast.authorFid },
    });
  }
}

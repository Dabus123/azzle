import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { generateTrailerBundle } from "../../content/generate-trailer.js";
import { readdirSync } from "node:fs";
import { trailersDir } from "../../content/outputs.js";

const ID: AgentIdentity = {
  id: "content-studio",
  name: "Trailer Studio",
  layer: "outreach",
  modelTier: "medium",
  mission: "Generate branded trailer videos — LLM timeline → code renderer → FFmpeg → outputs/trailers/.",
  publishSubjects: [SUBJECTS.CONTENT_TRAILER_READY],
  subscribeSubjects: [
    SUBJECTS.TREND_SIGNAL,
    SUBJECTS.AAIES_CYCLE_COMPLETE,
    SUBJECTS.MISSION_ASSIGNED,
  ],
};

const MIN_INTERVAL_MS = Number(process.env.AZZLE_TRAILER_INTERVAL_MS ?? String(2 * 60 * 60 * 1000));
const MAX_PER_DAY = Number(process.env.AZZLE_TRAILER_MAX_PER_DAY ?? "4");

export class ContentStudio extends BaseAgent {
  private lastGeneratedAt = 0;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  private enabled(): boolean {
    return process.env.AZZLE_TRAILER_ENABLED === "true";
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (!this.enabled()) return;
    if (subject === SUBJECTS.TREND_SIGNAL && msg.payload?.headline) {
      await this.maybeGenerate(String(msg.payload.headline), "trend-signal");
    }
    if (subject === SUBJECTS.AAIES_CYCLE_COMPLETE && msg.payload?.top_query) {
      await this.maybeGenerate(String(msg.payload.top_query), "aaies");
    }
  }

  protected async executeMission(mission: {
    id: string;
    payload: Record<string, unknown>;
    target_entity_id?: string;
  }): Promise<void> {
    if (!this.enabled()) return;
    const topic = String(mission.payload.topic ?? mission.payload.headline ?? "").trim();
    if (topic) {
      await this.generateOne(topic, "mission");
      return;
    }
    await this.tick();
  }

  protected async tick(): Promise<void> {
    if (!this.enabled()) return;
    if (!this.canGenerate()) return;

    const topics = [
      "Autonomous agents posting USDC tasks on Base",
      "Agent escrow markets — no middleman, on-chain settlement",
      "MCP servers and AI agents earning real work on AZZLE",
    ];
    const topic = topics[Math.floor(Math.random() * topics.length)]!;
    await this.generateOne(topic, "scheduled");
  }

  private canGenerate(): boolean {
    if (Date.now() - this.lastGeneratedAt < MIN_INTERVAL_MS) return false;
    if (this.countTodayTrailers() >= MAX_PER_DAY) return false;
    return true;
  }

  private countTodayTrailers(): number {
    try {
      const today = new Date().toISOString().slice(0, 10);
      return readdirSync(trailersDir()).filter((f) => f.startsWith(today) && f.endsWith(".mp4")).length;
    } catch {
      return 0;
    }
  }

  private async maybeGenerate(topic: string, source: string): Promise<void> {
    if (!this.canGenerate()) return;
    await this.generateOne(topic, source);
  }

  private async generateOne(topic: string, source: string): Promise<void> {
    try {
      const result = await generateTrailerBundle(this.ctx, { topic, source });
      this.lastGeneratedAt = Date.now();

      await this.ctx.writer.write({
        agent: this.identity.id,
        type: "market",
        name: `trailer-${result.slug}`,
        metadata: {
          trailer_slug: result.slug,
          mp4_path: result.mp4Path,
          caption_path: result.captionPath,
          caption: result.caption,
          frame_count: result.frameCount,
          topic,
          source,
        },
      });

      await this.ctx.bus.publish(SUBJECTS.CONTENT_TRAILER_READY, this.identity.id, {
        slug: result.slug,
        mp4_path: result.mp4Path,
        caption: result.caption,
        topic,
      });

      console.log(`[${this.identity.id}] trailer → ${result.mp4Path} (${result.frameCount} frames)`);
      console.log(`[${this.identity.id}] caption → ${result.caption.slice(0, 100)}…`);
    } catch (err) {
      console.error(`[${this.identity.id}] trailer failed:`, err);
    }
  }
}

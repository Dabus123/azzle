import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { loadFarcasterConfig, farcasterAutopostEnabled, resolveSnapPublicUrl } from "../../farcaster/config.js";
import { canFarcasterAction } from "../../farcaster/rate-limit.js";
import { draftFarcasterCast, finalizeCastText } from "../../farcaster/draft.js";
import {
  deployHumanTerminal,
  resolveMiniappDeployConfig,
} from "../../farcaster/github-pages.js";
import { pickUseCaseAngle, recentFarcasterCastBodies } from "../../farcaster/use-cases.js";
import { GraphWriter } from "../../graph/writer.js";

const ID: AgentIdentity = {
  id: "farcaster-shipper",
  name: "Farcaster Shipper",
  layer: "outreach",
  modelTier: "medium",
  mission: "Deploy Human Terminal miniapp to GitHub Pages and post viral Snap + miniapp casts.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT, SUBJECTS.CONTENT_TRAILER_READY],
  subscribeSubjects: [SUBJECTS.MISSION_ASSIGNED, SUBJECTS.SWARM_SPAWN_REQUEST],
};

const SHIP_COOLDOWN_MS =
  Number(process.env.AZZLE_SHIP_COOLDOWN_HOURS ?? "168") * 60 * 60 * 1000;
const POST_COOLDOWN_MS =
  Number(process.env.AZZLE_SHIP_POST_COOLDOWN_HOURS ?? "24") * 60 * 60 * 1000;

/** Stable graph entity for Human Terminal ship / cast logs */
const HUMAN_TERMINAL_ENTITY_ID = "a7e4c901-3f2b-4d5e-9c1a-0b8f6e2d4a10";

export class FarcasterShipper extends BaseAgent {
  private lastShipAt = 0;
  private lastPostAt = 0;
  private miniappUrl = "";
  private snapUrl = "";
  private templateIndex = 0;
  private loggedNoToken = false;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(): Promise<void> {
    await this.shipAndPost();
  }

  protected async tick(): Promise<void> {
    if (process.env.AZZLE_SHIP_ENABLED === "false") return;
    await this.shipAndPost();
  }

  private async shipAndPost(): Promise<void> {
    if (!this.ctx.config.githubToken) {
      if (!this.loggedNoToken) {
        console.log(`[${this.identity.id}] skip — GITHUB_TOKEN not set`);
        this.loggedNoToken = true;
      }
      return;
    }

    const now = Date.now();
    const force = process.env.AZZLE_FORCE_SHIP === "1";

    if (!force && now - this.lastShipAt < SHIP_COOLDOWN_MS && this.miniappUrl) {
      if (now - this.lastPostAt >= POST_COOLDOWN_MS) {
        await this.postLaunchCast();
      }
      return;
    }

    try {
      const cfg = await resolveMiniappDeployConfig(this.ctx.github);
      console.log(
        `[${this.identity.id}] deploying to ${cfg.repo} (branch ${cfg.branch})`
      );
      const result = await deployHumanTerminal(this.ctx.github, cfg);
      this.miniappUrl = result.miniappUrl;
      this.snapUrl = resolveSnapPublicUrl();
      this.lastShipAt = now;

      console.log(
        `[${this.identity.id}] deployed ${result.filesDeployed} file(s) → ${result.miniappUrl}`
      );

      await this.ctx.postgres.logAudit(this.identity.id, "miniapp_deployed", {
        miniapp_url: result.miniappUrl,
        files: result.filesDeployed,
        repo: cfg.repo,
        branch: cfg.branch,
      });

      await this.ctx.bus.publish(
        SUBJECTS.CONTENT_TRAILER_READY,
        this.identity.id,
        {
          topic: "Human Terminal miniapp",
          caption: `Live on GitHub Pages: ${result.miniappUrl}`,
          miniapp_url: result.miniappUrl,
          snap_url: this.snapUrl || null,
        }
      );

      if (farcasterAutopostEnabled()) {
        await this.postLaunchCast();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] deploy failed: ${message}`);
      if (farcasterAutopostEnabled() && process.env.AZZLE_FORCE_SHIP === "1") {
        await this.postLaunchCast();
      }
    }
  }

  private async ensureShipEntity(): Promise<string> {
    const existing = await this.ctx.postgres.getEntity(HUMAN_TERMINAL_ENTITY_ID);
    if (existing) return HUMAN_TERMINAL_ENTITY_ID;

    return this.ctx.writer.write({
      agent: this.identity.id,
      entityId: HUMAN_TERMINAL_ENTITY_ID,
      type: "market",
      name: "human-terminal-miniapp",
      metadata: {
        human_terminal: true,
        miniapp_url: this.miniappUrl || undefined,
      },
      score: { type: "azzle_probability", value: 0.8, reason: "Human Terminal miniapp" },
    });
  }

  private async postLaunchCast(): Promise<void> {
    if (!this.ctx.farcaster?.isConfigured()) return;
    if (!this.miniappUrl) {
      const cfg = await resolveMiniappDeployConfig(this.ctx.github);
      const base = cfg.baseUrl?.replace(/\/?$/, "/") ?? this.ctx.github.pagesBaseUrl(cfg.repo);
      const prefix = cfg.pagesPrefix.replace(/^\//, "").replace(/\/$/, "");
      this.miniappUrl = prefix ? `${base}${prefix}/` : base;
    }

    const now = Date.now();
    if (now - this.lastPostAt < POST_COOLDOWN_MS) return;

    const cfg = loadFarcasterConfig();
    const recent = await this.ctx.postgres.listRecentOutreach(1500);
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
    if (!budget.ok) return;

    const channels = cfg.postChannels.filter((id) =>
      cfg.channels.some((c) => c.id === id && c.post)
    );
    if (channels.length === 0) return;

    const recentBodies = recentFarcasterCastBodies(recent);
    const channelId = channels[this.templateIndex % channels.length]!;
    const angle = pickUseCaseAngle(cfg, this.templateIndex++, recentBodies, channelId);

    const brand = this.ctx.config.outreachBrand;
    const embedUrl = this.snapUrl || this.miniappUrl;

    const draft = await draftFarcasterCast(this.ctx, {
      post_style: "use_case_explainer",
      channel_id: channelId,
      use_case_id: angle.id,
      use_case_hook: angle.hook,
      use_case_scenario: angle.scenario,
      miniapp_url: this.miniappUrl,
      snap_url: this.snapUrl || null,
      embed_url: embedUrl,
      site_url: brand.siteUrl,
      recent_casts: recentBodies.slice(0, 8),
    });

    const text = finalizeCastText(
      { ...draft, include_link: false },
      "",
      `${angle.hook}: ${angle.scenario}`
    );
    if (text.length < 20) return;

    const contentHash = GraphWriter.hashContent(text + embedUrl);
    const entityId = await this.ensureShipEntity();

    try {
      const result = await this.ctx.farcaster.publishCast(text, {
        channelId,
        embedUrl,
      });

      await this.ctx.postgres.logOutreach(entityId, "farcaster_cast", "sent", {
        contentHash,
        body: text,
        subject: `ship:${channelId}:${angle.id}`,
      });
      await this.ctx.bus.publish(
        SUBJECTS.OUTREACH_SENT,
        this.identity.id,
        {
          channel: "farcaster_cast",
          destination: result.hash,
          content_hash: contentHash,
          miniapp_url: this.miniappUrl,
          snap_url: this.snapUrl || null,
        },
        entityId
      );
      this.lastPostAt = now;
      console.log(`[${this.identity.id}] launch cast → /${channelId} [${angle.id}] embed=${embedUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] launch cast failed: ${message}`);
    }
  }

  /** CLI helper — deploy + optional cast without waiting for tick cooldown. */
  async runShipNow(postCast = true): Promise<{ miniappUrl: string; snapUrl: string; deployed: boolean }> {
    process.env.AZZLE_FORCE_SHIP = "1";
    const cfg = await resolveMiniappDeployConfig(this.ctx.github);
    const base = cfg.baseUrl?.replace(/\/?$/, "/") ?? this.ctx.github.pagesBaseUrl(cfg.repo);
    const prefix = cfg.pagesPrefix.replace(/^\//, "").replace(/\/$/, "");
    this.miniappUrl = prefix ? `${base}${prefix}/` : base;
    this.snapUrl = resolveSnapPublicUrl();
    let deployed = false;
    try {
      await deployHumanTerminal(this.ctx.github, cfg);
      this.lastShipAt = Date.now();
      deployed = true;
      console.log(`[${this.identity.id}] deployed → ${this.miniappUrl}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${this.identity.id}] deploy failed: ${message}`);
    }
    if (postCast && farcasterAutopostEnabled()) {
      this.lastPostAt = 0;
      await this.postLaunchCast();
    }
    return { miniappUrl: this.miniappUrl, snapUrl: this.snapUrl, deployed };
  }
}

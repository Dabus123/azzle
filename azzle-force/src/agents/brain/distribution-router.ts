import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "distribution-router",
  name: "Distribution Router",
  layer: "brain",
  modelTier: "cheap",
  mission: "Route prospects to the highest-conversion channel based on signals.",
  publishSubjects: [SUBJECTS.GRAPH_ENTITY_UPDATED],
  subscribeSubjects: [SUBJECTS.SIGNAL_DETECTED, SUBJECTS.SCORE_UPDATED],
};

export class DistributionRouter extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (msg.entity_id) await this.route(msg.entity_id);
  }

  protected async tick(): Promise<void> {
    const hot = await this.ctx.postgres.topByScore("relationship_heat", 0.4, 20);
    for (const row of hot) {
      await this.route(String(row.id));
    }
  }

  private async route(entityId: string): Promise<void> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) return;

    const meta = (entity.metadata ?? {}) as Record<string, unknown>;
    const signals = await this.ctx.postgres.listEntitySignals(entityId);
    const types = signals.map((s) => String(s.payload.type ?? ""));

    let preferred: "email" | "dm" | "discord" | "reddit" | "farcaster" = "farcaster";
    let proximity = "cold";

    const metaFc = meta.farcaster as Record<string, unknown> | undefined;
    const metaReddit = meta.reddit as Record<string, unknown> | undefined;
    if (metaFc?.hash || (entity.type === "market" && metaFc)) {
      preferred = "farcaster";
      proximity = "farcaster_cast";
    } else if (metaReddit?.post_id || (entity.type === "market" && metaReddit)) {
      preferred = "reddit";
      proximity = "reddit_thread";
    } else if (types.includes("posted_task")) {
      preferred = "email";
      proximity = "on_chain_actor";
    } else if (entity.type === "community") {
      preferred = "farcaster";
      proximity = "community";
    } else if (types.includes("farcaster_cast") || types.includes("social_engagement")) {
      preferred = "farcaster";
      proximity = "social";
    } else if (types.includes("farcaster_reply")) {
      preferred = "farcaster";
      proximity = "social";
    }

    const next = {
      ...meta,
      distribution: {
        preferred_channel: preferred,
        proximity,
        routed_at: new Date().toISOString(),
      },
    };

    if (JSON.stringify(meta.distribution) === JSON.stringify(next.distribution)) return;

    await this.ctx.postgres.upsertEntity(entity.type, entity.name, next, entityId);
    await this.ctx.bus.publish(
      SUBJECTS.GRAPH_ENTITY_UPDATED,
      this.identity.id,
      { distribution: next.distribution },
      entityId
    );
  }
}

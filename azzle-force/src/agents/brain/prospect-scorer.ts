import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { decayScore, computeRelationshipHeat, type EntitySignal } from "../../brain/scoring.js";

const ID: AgentIdentity = {
  id: "prospect-scorer",
  name: "Prospect Scorer",
  layer: "brain",
  modelTier: "cheap",
  mission: "Apply temporal decay and relationship heat so hot prospects surface first.",
  publishSubjects: [SUBJECTS.SCORE_UPDATED],
  subscribeSubjects: [SUBJECTS.SIGNAL_DETECTED, SUBJECTS.OUTREACH_REPLIED, SUBJECTS.OUTREACH_SENT],
};

const BATCH = 40;

export class ProspectScorer extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (msg.entity_id) await this.rescore(msg.entity_id);
  }

  protected async tick(): Promise<void> {
    const brain = this.ctx.config.forceConfig.brain;
    const halfLife = brain?.decayHalfLifeDays ?? 14;
    const entities = await this.ctx.postgres.listEntities(BATCH * 3);
    let updated = 0;

    for (const row of entities.slice(0, BATCH)) {
      const entityId = String(row.id);
      const fit = await this.ctx.postgres.getScore(entityId, "azzle_probability");
      if (!fit) continue;

      const decayed = decayScore(fit.value, fit.computed_at, halfLife);
      if (Math.abs(decayed - fit.value) > 0.02) {
        await this.ctx.postgres.upsertScore(
          entityId,
          "azzle_probability",
          decayed,
          `decayed from ${fit.value.toFixed(2)} (${halfLife}d half-life)`
        );
      }

      await this.rescore(entityId);
      updated++;
    }

    if (updated > 0) {
      console.log(`[${this.identity.id}] rescored ${updated} entities (decay + heat)`);
    }
  }

  private async rescore(entityId: string): Promise<void> {
    const fit = await this.ctx.postgres.getScore(entityId, "azzle_probability");
    const base = fit?.value ?? 0;
    const signalRows = await this.ctx.postgres.listEntitySignals(entityId);
    const signals: EntitySignal[] = signalRows.map((r) => ({
      type: String(r.payload.type ?? "signal"),
      strength: Number(r.payload.strength ?? 0.5),
      at: new Date(r.created_at),
    }));
    const outreach = await this.ctx.postgres.listOutreachForEntity(entityId);
    const { heat, reason } = computeRelationshipHeat({
      baseFit: base,
      signals,
      outreach: outreach.map((o) => ({
        status: String(o.status),
        created_at: o.created_at as string | Date | undefined,
        sent_at: o.sent_at as string | Date | null | undefined,
      })),
    });

    await this.ctx.postgres.upsertScore(entityId, "relationship_heat", heat, reason);
    await this.ctx.bus.publish(
      SUBJECTS.SCORE_UPDATED,
      this.identity.id,
      { relationship_heat: heat, reason },
      entityId
    );
  }
}

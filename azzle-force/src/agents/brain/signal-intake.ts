import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const ID: AgentIdentity = {
  id: "signal-intake",
  name: "Signal Intake",
  layer: "brain",
  modelTier: "cheap",
  mission: "Ingest on-chain and market signals — not just GitHub stars.",
  publishSubjects: [SUBJECTS.SIGNAL_DETECTED],
  subscribeSubjects: [SUBJECTS.DISCOVERY_REPO_FOUND, SUBJECTS.MISSION_ASSIGNED],
};

export class SignalIntake extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async tick(): Promise<void> {
    await this.ingestOpenTaskPosters();
  }

  private async ingestOpenTaskPosters(): Promise<void> {
    let tasks: Array<{ id: string; poster?: { id: string }; escrowAmount?: string }> = [];
    try {
      tasks = (await this.ctx.azzle.getOpenTasks(15)) as typeof tasks;
    } catch (err) {
      console.warn(`[${this.identity.id}] subgraph unavailable:`, err);
      return;
    }

    for (const task of tasks) {
      const poster = task.poster?.id;
      if (!poster) continue;

      const name = `poster-${poster.slice(0, 10)}`;
      const entityId = await this.ctx.postgres.upsertEntity("person", name, {
        wallet: poster,
        signal_source: "azzle_subgraph",
        last_task_id: task.id,
      });

      await this.ctx.postgres.recordSignal(entityId, this.identity.id, "posted_task", 0.85, {
        task_id: task.id,
        escrow: task.escrowAmount,
      });

      await this.ctx.bus.publish(
        SUBJECTS.SIGNAL_DETECTED,
        this.identity.id,
        { type: "posted_task", task_id: task.id, poster },
        entityId
      );
    }

    if (tasks.length > 0) {
      console.log(`[${this.identity.id}] ingested ${tasks.length} on-chain task poster signal(s)`);
    }
  }
}

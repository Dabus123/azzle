import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { evolvePlaybooks } from "../../brain/evolve.js";

const ID: AgentIdentity = {
  id: "prompt-evolver",
  name: "Prompt Evolver",
  layer: "brain",
  modelTier: "medium",
  mission: "Compare outreach variants and rewrite agent playbooks from outcomes.",
  publishSubjects: [SUBJECTS.PLAYBOOK_UPDATED],
  subscribeSubjects: [SUBJECTS.OUTCOME_RECORDED],
};

export class PromptEvolver extends BaseAgent {
  private outcomesSinceEvolve = 0;
  private lastEvolveMs = Date.now();
  private evolving = false;

  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(_subject: string, _msg: import("../../types.js").NatsMessage): Promise<void> {
    this.outcomesSinceEvolve++;
    const minOutcomes = this.ctx.config.forceConfig.brain?.evolveAfterOutcomes ?? 25;
    if (this.outcomesSinceEvolve >= minOutcomes) {
      await this.evolve("outcomes");
    }
  }

  protected async tick(): Promise<void> {
    const hours = this.ctx.config.forceConfig.brain?.evolveIntervalHours ?? 336;
    const intervalMs = hours * 3600 * 1000;
    if (Date.now() - this.lastEvolveMs >= intervalMs) {
      await this.evolve("interval");
    }
  }

  private async evolve(reason: string): Promise<void> {
    if (this.evolving) return;
    this.evolving = true;
    try {
      const notes = await evolvePlaybooks(this.ctx);
      this.outcomesSinceEvolve = 0;
      this.lastEvolveMs = Date.now();
      const summary = notes.length > 0 ? notes.join("; ") : "no playbook changes (insufficient reply variance)";
      console.log(`[${this.identity.id}] ${reason} — ${summary}`);
      if (notes.length > 0) {
        await this.ctx.bus.publish(SUBJECTS.PLAYBOOK_UPDATED, this.identity.id, { notes });
      }
    } finally {
      this.evolving = false;
    }
  }
}

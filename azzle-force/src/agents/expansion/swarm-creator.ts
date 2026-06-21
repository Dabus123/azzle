import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";

const NICHE_AGENT_MAP: Record<string, string[]> = {
  "crypto-agents": ["agent-hunter", "personalizer", "ecosystem-matchmaker"],
  "mcp-servers": ["repository-hunter", "contact-discovery", "qualification"],
  "autonomous-agents": ["agent-hunter", "builder-hunter", "onboarding"],
};

const ID: AgentIdentity = {
  id: "swarm-creator",
  name: "Swarm Creator",
  layer: "expansion",
  modelTier: "frontier",
  mission: "Spawn specialized sub-swarms when Trend Detector validates a niche.",
  publishSubjects: [SUBJECTS.SWARM_SPAWN_REQUEST, SUBJECTS.MISSION_ASSIGNED],
  subscribeSubjects: [SUBJECTS.TREND_SIGNAL, SUBJECTS.MISSION_ASSIGNED],
};

export class SwarmCreator extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject !== SUBJECTS.TREND_SIGNAL) return;

    const niche = String(msg.payload.niche ?? "");
    const strength = Number(msg.payload.strength ?? 0);
    const spawnRecommended = Boolean(msg.payload.spawn_recommended);

    if (!spawnRecommended || strength < 0.7) return;

    const agents = NICHE_AGENT_MAP[niche] ?? NICHE_AGENT_MAP["autonomous-agents"];
    for (const agentType of agents) {
      await this.ctx.postgres.createMission(agentType, undefined, {
        spawned_by: this.identity.id,
        niche,
        strength,
        approval: "temporal_multi_step",
      });
      await this.ctx.bus.publish(
        SUBJECTS.MISSION_ASSIGNED,
        this.identity.id,
        { agent_type: agentType, niche },
      );
    }

    if (this.ctx.temporal) {
      await this.ctx.temporal.startSpawnApproval(niche, agents);
    }

    console.log(`[${this.identity.id}] spawned sub-swarm for ${niche}: ${agents.join(", ")}`);
  }

  protected async tick(): Promise<void> {
    /* event-driven */
  }
}

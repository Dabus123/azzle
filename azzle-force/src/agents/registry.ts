import type { BaseAgent } from "./base.js";
import type { ForceContext } from "../context.js";
import { RepositoryHunter } from "./discovery/repository-hunter.js";
import { AgentHunter } from "./discovery/agent-hunter.js";
import { BuilderHunter } from "./discovery/builder-hunter.js";
import { StartupHunter } from "./discovery/startup-hunter.js";
import { CommunityHunter } from "./discovery/community-hunter.js";
import { OpportunityHunter } from "./discovery/opportunity-hunter.js";
import { ContactDiscovery } from "./discovery/contact-discovery.js";
import { RelationshipMapper } from "./discovery/relationship-mapper.js";
import { Personalizer } from "./outreach/personalizer.js";
import { Messenger } from "./outreach/messenger.js";
import { FollowUpAgent } from "./outreach/follow-up.js";
import { Ambassador } from "./outreach/ambassador.js";
import { Qualification } from "./conversion/qualification.js";
import { Onboarding } from "./conversion/onboarding.js";
import { EcosystemMatchmaker } from "./conversion/ecosystem-matchmaker.js";
import { EcosystemAnalyst } from "./intelligence/ecosystem-analyst.js";
import { TrendDetector } from "./intelligence/trend-detector.js";
import { CompetitiveIntelligence } from "./intelligence/competitive-intelligence.js";
import { SwarmCreator } from "./expansion/swarm-creator.js";
import { ChiefExpansion } from "./expansion/chief-expansion.js";

export const AGENT_FACTORIES: Record<string, (ctx: ForceContext) => BaseAgent> = {
  "repository-hunter": (ctx) => new RepositoryHunter(ctx),
  "agent-hunter": (ctx) => new AgentHunter(ctx),
  "builder-hunter": (ctx) => new BuilderHunter(ctx),
  "startup-hunter": (ctx) => new StartupHunter(ctx),
  "community-hunter": (ctx) => new CommunityHunter(ctx),
  "opportunity-hunter": (ctx) => new OpportunityHunter(ctx),
  "contact-discovery": (ctx) => new ContactDiscovery(ctx),
  "relationship-mapper": (ctx) => new RelationshipMapper(ctx),
  "personalizer": (ctx) => new Personalizer(ctx),
  "messenger": (ctx) => new Messenger(ctx),
  "follow-up": (ctx) => new FollowUpAgent(ctx),
  "ambassador": (ctx) => new Ambassador(ctx),
  "qualification": (ctx) => new Qualification(ctx),
  "onboarding": (ctx) => new Onboarding(ctx),
  "ecosystem-matchmaker": (ctx) => new EcosystemMatchmaker(ctx),
  "ecosystem-analyst": (ctx) => new EcosystemAnalyst(ctx),
  "trend-detector": (ctx) => new TrendDetector(ctx),
  "competitive-intelligence": (ctx) => new CompetitiveIntelligence(ctx),
  "swarm-creator": (ctx) => new SwarmCreator(ctx),
  "chief-expansion": (ctx) => new ChiefExpansion(ctx),
};

export const ALL_AGENT_IDS = Object.keys(AGENT_FACTORIES);

export function agentsForWave(wave: number | "all", config: ForceContext["config"]): string[] {
  if (wave === "all" || wave === 0) {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const w of [1, 2, 3]) {
      for (const id of config.forceConfig.waves[String(w)] ?? []) {
        if (!seen.has(id) && AGENT_FACTORIES[id]) {
          seen.add(id);
          merged.push(id);
        }
      }
    }
    return merged;
  }
  const waveAgents = config.forceConfig.waves[String(wave)] ?? [];
  return waveAgents.filter((id: string) => AGENT_FACTORIES[id]);
}

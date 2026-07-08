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
import { ContentStudio } from "./outreach/content-studio.js";
import { Qualification } from "./conversion/qualification.js";
import { Onboarding } from "./conversion/onboarding.js";
import { EcosystemMatchmaker } from "./conversion/ecosystem-matchmaker.js";
import { EcosystemAnalyst } from "./intelligence/ecosystem-analyst.js";
import { TrendDetector } from "./intelligence/trend-detector.js";
import { CompetitiveIntelligence } from "./intelligence/competitive-intelligence.js";
import { AiSearchInclusion } from "./intelligence/ai-search-inclusion.js";
import { SwarmCreator } from "./expansion/swarm-creator.js";
import { ChiefExpansion } from "./expansion/chief-expansion.js";
import { ProspectScorer } from "./brain/prospect-scorer.js";
import { OutcomeTracker } from "./brain/outcome-tracker.js";
import { ObjectionHandler } from "./brain/objection-handler.js";
import { Sequencer } from "./brain/sequencer.js";
import { Closer } from "./brain/closer.js";
import { PromptEvolver } from "./brain/prompt-evolver.js";
import { SignalIntake } from "./brain/signal-intake.js";
import { DistributionRouter } from "./brain/distribution-router.js";
import { StrategyOptimizer } from "./brain/strategy-optimizer.js";
import { RedditHunter } from "./reddit/reddit-hunter.js";
import { RedditResponder } from "./reddit/reddit-responder.js";
import { RedditPoster } from "./reddit/reddit-poster.js";
import { FarcasterHunter } from "./farcaster/farcaster-hunter.js";
import { FarcasterPoster } from "./farcaster/farcaster-poster.js";
import { FarcasterReplier } from "./farcaster/farcaster-replier.js";
import { FarcasterLiker } from "./farcaster/farcaster-liker.js";
import { FarcasterShipper } from "./farcaster/farcaster-shipper.js";

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
  "content-studio": (ctx) => new ContentStudio(ctx),
  "qualification": (ctx) => new Qualification(ctx),
  "onboarding": (ctx) => new Onboarding(ctx),
  "ecosystem-matchmaker": (ctx) => new EcosystemMatchmaker(ctx),
  "ecosystem-analyst": (ctx) => new EcosystemAnalyst(ctx),
  "trend-detector": (ctx) => new TrendDetector(ctx),
  "competitive-intelligence": (ctx) => new CompetitiveIntelligence(ctx),
  "aaies": (ctx) => new AiSearchInclusion(ctx),
  "ai-search-inclusion": (ctx) => new AiSearchInclusion(ctx),
  "swarm-creator": (ctx) => new SwarmCreator(ctx),
  "chief-expansion": (ctx) => new ChiefExpansion(ctx),
  "prospect-scorer": (ctx) => new ProspectScorer(ctx),
  "outcome-tracker": (ctx) => new OutcomeTracker(ctx),
  "objection-handler": (ctx) => new ObjectionHandler(ctx),
  "sequencer": (ctx) => new Sequencer(ctx),
  "closer": (ctx) => new Closer(ctx),
  "prompt-evolver": (ctx) => new PromptEvolver(ctx),
  "signal-intake": (ctx) => new SignalIntake(ctx),
  "distribution-router": (ctx) => new DistributionRouter(ctx),
  "strategy-optimizer": (ctx) => new StrategyOptimizer(ctx),
  "reddit-hunter": (ctx) => new RedditHunter(ctx),
  "reddit-responder": (ctx) => new RedditResponder(ctx),
  "reddit-poster": (ctx) => new RedditPoster(ctx),
  "farcaster-hunter": (ctx) => new FarcasterHunter(ctx),
  "farcaster-poster": (ctx) => new FarcasterPoster(ctx),
  "farcaster-replier": (ctx) => new FarcasterReplier(ctx),
  "farcaster-liker": (ctx) => new FarcasterLiker(ctx),
  "farcaster-shipper": (ctx) => new FarcasterShipper(ctx),
};

export const ALL_AGENT_IDS = Object.keys(AGENT_FACTORIES);

export function agentsForWave(wave: number | "all", config: ForceContext["config"]): string[] {
  if (wave === "all" || wave === 0) {
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const w of [1, 2, 3, 6]) {
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

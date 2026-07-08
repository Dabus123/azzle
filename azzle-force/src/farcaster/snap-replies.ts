import type { FarcasterConfig } from "./config.js";

export interface SnapReplySeed {
  id: string;
  /** Keywords in parent cast text (any match boosts score). */
  triggers?: string[];
  /** Short description of the interactive moment for the LLM. */
  interaction: string;
  /** Example invite tone — inspiration, not copy-paste. */
  inviteExample: string;
}

const DEFAULT_SEEDS: SnapReplySeed[] = [
  {
    id: "vibe-check",
    triggers: ["agent", "ai", "autonomous", "prompt", "llm", "gpt", "claude"],
    interaction: "Live poll: Still prompting vs Went agentic — confetti when they vote.",
    inviteExample:
      "🎯 Strong take. Tap the embed — vote your mode (still prompting vs agentic) and peek Human Terminal.",
  },
  {
    id: "builder-mode",
    triggers: ["ship", "build", "deploy", "base", "onchain", "dev", "hack"],
    interaction: "Human Terminal miniapp + poll — builders pick their mode and see live split.",
    inviteExample:
      "Fellow builder energy — tap the snap, vote your mode, peek Human Terminal if you're feeling brave.",
  },
  {
    id: "mcp-labor",
    triggers: ["mcp", "tool", "server", "workflow", "skill"],
    interaction: "Poll framed around who still hand-wires tools vs agents that post/claim/prove.",
    inviteExample:
      "MCP gang — made a lil interactive snap about escaping prompt hell. Where do you land?",
  },
  {
    id: "usdc-work",
    triggers: ["usdc", "escrow", "pay", "earn", "bounty", "marketplace", "task"],
    interaction: "Vote + progress bar showing agentic vs prompting split on Base labor.",
    inviteExample:
      "This is the convo — tap the embed, vote, watch the bar move. Gentle vibe check for onchain work.",
  },
  {
    id: "warm-open",
    triggers: [],
    interaction: "Default: poll + Human Terminal — invite with warmth, zero pitch deck energy.",
    inviteExample:
      "No pitch — just a playful snap. Vote your mode, confetti if you're lucky, terminal if you're curious.",
  },
];

function scoreSeed(seed: SnapReplySeed, parentText: string): number {
  const lower = parentText.toLowerCase();
  if (!seed.triggers?.length) return 0;
  return seed.triggers.filter((t) => lower.includes(t.toLowerCase())).length;
}

export function snapReplySeeds(cfg: FarcasterConfig): SnapReplySeed[] {
  const fromCfg = (cfg as FarcasterConfig & { snapReplySeeds?: SnapReplySeed[] }).snapReplySeeds;
  return fromCfg?.length ? fromCfg : DEFAULT_SEEDS;
}

/** Pick a snap interaction angle matched to the parent cast. */
export function pickSnapReplySeed(
  cfg: FarcasterConfig,
  parentText: string,
  cursor: number,
  recentBodies: string[] = []
): SnapReplySeed {
  const seeds = snapReplySeeds(cfg);
  const ranked = seeds
    .map((seed, idx) => ({ seed, idx, score: scoreSeed(seed, parentText) }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const topScore = ranked[0]?.score ?? 0;
  const pool =
    topScore > 0 ? ranked.filter((r) => r.score > 0).map((r) => r.seed) : seeds;

  for (let i = 0; i < pool.length; i++) {
    const seed = pool[(cursor + i) % pool.length]!;
    const snippet = seed.inviteExample.slice(0, 40).toLowerCase();
    if (!recentBodies.some((b) => b.toLowerCase().includes(snippet))) return seed;
  }

  return pool[cursor % pool.length] ?? seeds[0]!;
}

export function recentFarcasterReplyBodies(
  rows: Array<{ channel?: string; body?: string }>,
  limit = 10
): string[] {
  return rows
    .filter((r) => r.channel === "farcaster_reply" && r.body?.trim())
    .map((r) => r.body!.trim())
    .slice(0, limit);
}

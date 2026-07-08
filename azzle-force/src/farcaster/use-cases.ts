import type { FarcasterConfig } from "./config.js";

export interface UseCaseAngle {
  id: string;
  hook: string;
  scenario: string;
  channels?: string[];
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function overlapsRecent(hook: string, recent: string[]): boolean {
  const h = normalize(hook);
  const prefix = h.slice(0, 48);
  return recent.some((r) => {
    const n = normalize(r);
    return n.includes(prefix) || prefix.includes(n.slice(0, 48));
  });
}

/** Pick a use-case angle that hasn't been used recently. */
export function pickUseCaseAngle(
  cfg: FarcasterConfig,
  cursor: number,
  recentBodies: string[] = [],
  channelId?: string
): UseCaseAngle {
  const seeds = cfg.useCaseSeeds ?? [];
  if (seeds.length === 0) {
    return {
      id: "fallback",
      hook: "An agent hires another agent onchain",
      scenario:
        "Poster funds USDC escrow, worker claims and proves delivery — no human PM in the loop.",
    };
  }

  const channelFiltered =
    channelId && seeds.some((s) => s.channels?.includes(channelId))
      ? seeds.filter((s) => !s.channels?.length || s.channels.includes(channelId))
      : seeds;

  const pool = channelFiltered.length > 0 ? channelFiltered : seeds;

  for (let i = 0; i < pool.length; i++) {
    const angle = pool[(cursor + i) % pool.length]!;
    if (!overlapsRecent(angle.hook, recentBodies)) return angle;
  }

  return pool[cursor % pool.length]!;
}

export function recentFarcasterCastBodies(
  rows: Array<{ channel?: string; body?: string }>,
  limit = 12
): string[] {
  return rows
    .filter((r) => r.channel === "farcaster_cast" && r.body?.trim())
    .map((r) => r.body!.trim())
    .slice(0, limit);
}

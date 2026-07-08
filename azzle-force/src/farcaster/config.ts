import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface FarcasterChannelConfig {
  id: string;
  post: boolean;
  reply: boolean;
}

export interface FarcasterRateLimits {
  maxCastsPerDay: number;
  maxRepliesPerDay: number;
  maxLikesPerDay: number;
  minMinutesBetweenActions: number;
}

export interface FarcasterConfig {
  version: number;
  channels: FarcasterChannelConfig[];
  searchQueries: string[];
  postChannels: string[];
  rateLimits: FarcasterRateLimits;
  useCaseSeeds?: Array<{
    id: string;
    hook: string;
    scenario: string;
    channels?: string[];
  }>;
  castRules: string[];
  replyRules: string[];
  snapReplySeeds?: Array<{
    id: string;
    triggers?: string[];
    interaction: string;
    inviteExample: string;
  }>;
}

const __dir = dirname(fileURLToPath(import.meta.url));

let cached: FarcasterConfig | null = null;

export function loadFarcasterConfig(): FarcasterConfig {
  if (cached) return cached;
  const path =
    process.env.AZZLE_FARCASTER_CONFIG ??
    resolve(__dir, "../../config/farcaster.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as FarcasterConfig;
  return cached;
}

export function farcasterAutopostEnabled(): boolean {
  if (process.env.FARCASTER_AUTOPOST === "false") return false;
  return Boolean(process.env.NEYNAR_API_KEY && process.env.NEYNAR_SIGNER_UUID);
}

/** Production Snap at azzle.org/snap (Vercel). Override with AZZLE_SNAP_PUBLIC_URL. */
export const DEFAULT_SNAP_PUBLIC_URL = "https://www.azzle.org/snap";

export function resolveSnapPublicUrl(): string {
  return (
    process.env.AZZLE_SNAP_PUBLIC_URL?.replace(/\/$/, "") ||
    process.env.AZZLE_SNAP_URL?.replace(/\/$/, "") ||
    DEFAULT_SNAP_PUBLIC_URL
  );
}

export function resolveMiniappPublicUrl(): string {
  const base =
    process.env.AZZLE_MINIAPP_URL?.replace(/\/?$/, "") ||
    process.env.GITHUB_PAGES_MINIAPP_URL?.replace(/\/?$/, "") ||
    "https://azzleforce.github.io/azzleforce";
  return `${base}/`;
}

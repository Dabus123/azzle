import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface RedditSubredditConfig {
  name: string;
  comment: boolean;
  post: boolean;
}

export interface RedditRateLimits {
  maxCommentsPerHour: number;
  maxPostsPerDay: number;
  minMinutesBetweenActions: number;
  maxThreadAgeHours: number;
  minThreadScore: number;
}

export interface RedditConfig {
  version: number;
  subreddits: RedditSubredditConfig[];
  searchQueries: string[];
  demoPostSubreddits: string[];
  rateLimits: RedditRateLimits;
  commentRules: string[];
  postRules: string[];
}

const __dir = dirname(fileURLToPath(import.meta.url));

let cached: RedditConfig | null = null;

export function loadRedditConfig(): RedditConfig {
  if (cached) return cached;
  const path =
    process.env.AZZLE_REDDIT_CONFIG ??
    resolve(__dir, "../../config/reddit.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as RedditConfig;
  return cached;
}

export function redditUserAgent(): string {
  return (
    process.env.REDDIT_USER_AGENT ??
    "azzle-force:expansion-organism:1.0 (contact: hello@azzle.org)"
  );
}

export function redditAutopostEnabled(): boolean {
  if (process.env.REDDIT_AUTOPOST === "false") return false;
  return Boolean(
    process.env.REDDIT_CLIENT_ID &&
      process.env.REDDIT_CLIENT_SECRET &&
      (process.env.REDDIT_REFRESH_TOKEN ||
        (process.env.REDDIT_USERNAME && process.env.REDDIT_PASSWORD))
  );
}

import type { RedditDelivery } from "../delivery/reddit.js";
import { redditUserAgent } from "./config.js";
import { parseRedditListing } from "./parse-listing.js";
import type { RedditThread } from "./types.js";

const PUBLIC_BASE = "https://www.reddit.com";

async function fetchPublicJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": redditUserAgent(), Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Reddit public API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function searchPublic(subreddit: string, query: string, limit: number): Promise<RedditThread[]> {
  const q = encodeURIComponent(query);
  const sr = encodeURIComponent(subreddit);
  const url =
    `${PUBLIC_BASE}/r/${sr}/search.json?q=${q}&restrict_sr=1&sort=new&t=week&limit=${limit}&raw_json=1`;
  return parseRedditListing(await fetchPublicJson(url));
}

/** Search — prefers OAuth (required on many IPs). */
export async function searchSubreddit(
  subreddit: string,
  query: string,
  limit = 25,
  oauth?: RedditDelivery | null
): Promise<RedditThread[]> {
  if (oauth?.isConfigured()) {
    return oauth.searchSubreddit(subreddit, query, limit);
  }
  return searchPublic(subreddit, query, limit);
}

export async function fetchRising(
  subreddit: string,
  limit = 15,
  oauth?: RedditDelivery | null
): Promise<RedditThread[]> {
  if (oauth?.isConfigured()) {
    return oauth.fetchRising(subreddit, limit);
  }
  const sr = encodeURIComponent(subreddit);
  const url = `${PUBLIC_BASE}/r/${sr}/rising.json?limit=${limit}&raw_json=1`;
  return parseRedditListing(await fetchPublicJson(url));
}

export async function fetchNew(
  subreddit: string,
  limit = 15,
  oauth?: RedditDelivery | null
): Promise<RedditThread[]> {
  if (oauth?.isConfigured()) {
    return oauth.fetchNew(subreddit, limit);
  }
  const sr = encodeURIComponent(subreddit);
  const url = `${PUBLIC_BASE}/r/${sr}/new.json?limit=${limit}&raw_json=1`;
  return parseRedditListing(await fetchPublicJson(url));
}

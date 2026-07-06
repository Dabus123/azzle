import type { RedditThread } from "./types.js";

/** Parse Reddit listing JSON (public or OAuth). */
export function parseRedditListing(data: unknown): RedditThread[] {
  if (typeof data !== "object" || data === null) return [];
  const listing = data as { data?: { children?: Array<{ data?: Record<string, unknown> }> } };
  const children = listing.data?.children ?? [];
  const out: RedditThread[] = [];

  for (const child of children) {
    const d = child.data;
    if (!d) continue;
    const postId = String(d.name ?? d.id ?? "");
    if (!postId.startsWith("t3_")) continue;
    if (d.stickied === true) continue;
    if (d.over_18 === true) continue;
    const author = String(d.author ?? "");
    if (author === "[deleted]" || author === "AutoModerator") continue;

    out.push({
      postId,
      subreddit: String(d.subreddit ?? ""),
      title: String(d.title ?? ""),
      selftext: String(d.selftext ?? ""),
      url: String(d.url ?? ""),
      permalink: `https://www.reddit.com${String(d.permalink ?? "")}`,
      score: Number(d.score ?? 0),
      numComments: Number(d.num_comments ?? 0),
      createdUtc: Number(d.created_utc ?? 0),
      author,
      over18: Boolean(d.over_18),
      stickied: Boolean(d.stickied),
    });
  }
  return out;
}

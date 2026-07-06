import { redditUserAgent } from "../reddit/config.js";
import { parseRedditListing } from "../reddit/parse-listing.js";
import type { RedditThread } from "../reddit/types.js";

export interface RedditAuthConfig {
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
  refreshToken?: string;
}

export interface RedditCommentResult {
  id: string;
  permalink: string;
}

export interface RedditSubmitResult {
  id: string;
  url: string;
  permalink: string;
}

/** OAuth client for comment + submit (autopost). */
export class RedditDelivery {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private config: RedditAuthConfig) {}

  isConfigured(): boolean {
    if (!this.config.clientId || !this.config.clientSecret) return false;
    return Boolean(
      this.config.refreshToken || (this.config.username && this.config.password)
    );
  }

  async searchSubreddit(subreddit: string, query: string, limit = 25): Promise<RedditThread[]> {
    const token = await this.getToken();
    const q = encodeURIComponent(query);
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search?q=${q}&restrict_sr=1&sort=new&t=week&limit=${limit}&raw_json=1`;
    return this.fetchListing(url, token);
  }

  async fetchRising(subreddit: string, limit = 15): Promise<RedditThread[]> {
    const token = await this.getToken();
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/rising?limit=${limit}&raw_json=1`;
    return this.fetchListing(url, token);
  }

  async fetchNew(subreddit: string, limit = 15): Promise<RedditThread[]> {
    const token = await this.getToken();
    const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/new?limit=${limit}&raw_json=1`;
    return this.fetchListing(url, token);
  }

  private async fetchListing(url: string, token: string): Promise<RedditThread[]> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Reddit API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    return parseRedditListing(data);
  }

  async comment(postFullname: string, text: string): Promise<RedditCommentResult> {
    const token = await this.getToken();
    const body = new URLSearchParams({
      api_type: "json",
      thing_id: postFullname.startsWith("t3_") ? postFullname : `t3_${postFullname}`,
      text,
    });

    const res = await fetch("https://oauth.reddit.com/api/comment", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Reddit comment failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const data = json.json as { errors?: unknown[]; data?: { things?: Array<{ data?: Record<string, unknown> }> } };
    if (data?.errors?.length) {
      throw new Error(`Reddit comment rejected: ${JSON.stringify(data.errors)}`);
    }

    const thing = data?.data?.things?.[0]?.data;
    const id = String(thing?.id ?? thing?.name ?? "");
    const permalink = thing?.permalink
      ? `https://www.reddit.com${String(thing.permalink)}`
      : "";
    return { id, permalink };
  }

  async submitSelfPost(
    subreddit: string,
    title: string,
    text: string
  ): Promise<RedditSubmitResult> {
    const token = await this.getToken();
    const body = new URLSearchParams({
      api_type: "json",
      kind: "self",
      sr: subreddit,
      title: title.slice(0, 300),
      text,
      sendreplies: "true",
      nsfw: "false",
      spoiler: "false",
    });

    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Reddit submit failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const data = json.json as {
      errors?: unknown[];
      data?: { id?: string; url?: string; name?: string };
    };
    if (data?.errors?.length) {
      throw new Error(`Reddit submit rejected: ${JSON.stringify(data.errors)}`);
    }

    const id = String(data?.data?.name ?? data?.data?.id ?? "");
    const url = String(data?.data?.url ?? "");
    const permalink = url.startsWith("http") ? url : `https://www.reddit.com${url}`;
    return { id, url, permalink };
  }

  async submitLinkPost(
    subreddit: string,
    title: string,
    url: string
  ): Promise<RedditSubmitResult> {
    const token = await this.getToken();
    const body = new URLSearchParams({
      api_type: "json",
      kind: "link",
      sr: subreddit,
      title: title.slice(0, 300),
      url,
      sendreplies: "true",
    });

    const res = await fetch("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": redditUserAgent(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Reddit link submit failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }

    const data = json.json as {
      errors?: unknown[];
      data?: { id?: string; url?: string; name?: string };
    };
    if (data?.errors?.length) {
      throw new Error(`Reddit link submit rejected: ${JSON.stringify(data.errors)}`);
    }

    const id = String(data?.data?.name ?? data?.data?.id ?? "");
    const postUrl = String(data?.data?.url ?? "");
    const permalink = postUrl.startsWith("http") ? postUrl : `https://www.reddit.com${postUrl}`;
    return { id, url: postUrl, permalink };
  }

  private async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
    const params = new URLSearchParams();

    if (this.config.refreshToken) {
      params.set("grant_type", "refresh_token");
      params.set("refresh_token", this.config.refreshToken);
    } else {
      params.set("grant_type", "password");
      params.set("username", this.config.username ?? "");
      params.set("password", this.config.password ?? "");
    }

    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "User-Agent": redditUserAgent(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) {
      throw new Error(`Reddit OAuth failed: ${json.error ?? res.status}`);
    }

    this.accessToken = json.access_token;
    this.tokenExpiresAt = Date.now() + (json.expires_in ?? 3600) * 1000;
    return this.accessToken;
  }
}

import type { FarcasterCast } from "../farcaster/types.js";

export interface FarcasterDeliveryConfig {
  apiKey: string;
  signerUuid: string;
}

export interface PublishCastResult {
  hash: string;
  authorFid?: number;
}

function parseCast(raw: Record<string, unknown>): FarcasterCast | null {
  const hash = String(raw.hash ?? "");
  if (!hash) return null;
  const author = raw.author as Record<string, unknown> | undefined;
  return {
    hash,
    authorFid: Number(author?.fid ?? raw.author_fid ?? 0),
    authorUsername: String(author?.username ?? ""),
    text: String(raw.text ?? ""),
    channelId: raw.channel
      ? String((raw.channel as Record<string, unknown>).id ?? raw.channel_id ?? "")
      : raw.parent_url
        ? String(raw.parent_url).split("/").pop() ?? null
        : null,
    timestamp: String(raw.timestamp ?? ""),
    parentHash: raw.parent_hash ? String(raw.parent_hash) : null,
    likes: Number((raw.reactions as Record<string, unknown>)?.likes_count ?? raw.likes ?? 0),
    replies: Number((raw.replies as Record<string, unknown>)?.count ?? raw.replies ?? 0),
  };
}

/** Neynar-backed Farcaster read + write. */
export class FarcasterDelivery {
  private readonly base = "https://api.neynar.com/v2/farcaster";

  constructor(private config: FarcasterDeliveryConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && this.config.signerUuid);
  }

  async publishLike(targetHash: string): Promise<void> {
    await this.neynarPost("/reaction", {
      signer_uuid: this.config.signerUuid,
      reaction_type: "like",
      target: targetHash,
    });
  }

  async publishCast(
    text: string,
    opts?: { channelId?: string; parentHash?: string; embedUrl?: string; embedUrls?: string[] }
  ): Promise<PublishCastResult> {
    const body: Record<string, unknown> = {
      signer_uuid: this.config.signerUuid,
      text: text.slice(0, 320),
    };
    if (opts?.channelId) body.channel_id = opts.channelId;
    if (opts?.parentHash) body.parent = opts.parentHash;

    const urls = [
      ...(opts?.embedUrls ?? []),
      ...(opts?.embedUrl ? [opts.embedUrl] : []),
    ]
      .map((u) => u.trim())
      .filter(Boolean);
    const unique = [...new Set(urls)].slice(0, 2);
    if (unique.length > 0) {
      body.embeds = unique.map((url) => ({ url }));
    }

    const json = await this.neynarPost("/cast", body);
    const cast = json.cast as Record<string, unknown> | undefined;
    return {
      hash: String(cast?.hash ?? ""),
      authorFid: Number((cast?.author as Record<string, unknown>)?.fid ?? 0),
    };
  }

  async fetchChannelFeed(channelId: string, limit = 25): Promise<FarcasterCast[]> {
    const params = new URLSearchParams({
      feed_type: "filter",
      filter_type: "channel_id",
      channel_id: channelId,
      limit: String(limit),
    });
    const json = await this.neynarGet(`/feed?${params}`);
    const casts = (json.casts ?? []) as Record<string, unknown>[];
    return casts.map(parseCast).filter(Boolean) as FarcasterCast[];
  }

  async searchCasts(query: string, limit = 25): Promise<FarcasterCast[]> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });
    const json = await this.neynarGet(`/cast/search?${params}`);
    const result = json.result as Record<string, unknown> | undefined;
    const casts = (json.casts ?? result?.casts ?? []) as Record<string, unknown>[];
    return casts.map(parseCast).filter(Boolean) as FarcasterCast[];
  }

  async getSignerStatus(): Promise<{ status: string; fid?: number; username?: string }> {
    const json = await this.neynarGet(`/signer?signer_uuid=${encodeURIComponent(this.config.signerUuid)}`);
    const signer = json as Record<string, unknown>;
    return {
      status: String(signer.status ?? "unknown"),
      fid: signer.fid != null ? Number(signer.fid) : undefined,
      username: signer.fid != null ? undefined : undefined,
    };
  }

  async fetchUserCasts(
    fid: number,
    opts?: { limit?: number; cursor?: string; includeReplies?: boolean }
  ): Promise<{ casts: FarcasterCast[]; nextCursor: string | null }> {
    const params = new URLSearchParams({
      fid: String(fid),
      limit: String(opts?.limit ?? 100),
      include_replies: String(opts?.includeReplies ?? true),
    });
    if (opts?.cursor) params.set("cursor", opts.cursor);

    const json = await this.neynarGet(`/feed/user/casts?${params}`);
    const result = json as Record<string, unknown>;
    const next = result.next as Record<string, unknown> | undefined;
    const casts = (result.casts ?? []) as Record<string, unknown>[];
    return {
      casts: casts.map(parseCast).filter(Boolean) as FarcasterCast[],
      nextCursor: next?.cursor != null ? String(next.cursor) : null,
    };
  }

  async fetchAllUserCasts(fid: number, includeReplies = true): Promise<FarcasterCast[]> {
    const all: FarcasterCast[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.fetchUserCasts(fid, {
        limit: 100,
        cursor,
        includeReplies,
      });
      all.push(...page.casts);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return all;
  }

  async deleteCast(targetHash: string): Promise<void> {
    await this.neynarDelete("/cast/", {
      signer_uuid: this.config.signerUuid,
      target_hash: targetHash,
    });
  }

  private async neynarDelete(path: string, body: Record<string, unknown>): Promise<void> {
    const res = await fetch(`${this.base}${path}`, {
      method: "DELETE",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Neynar DELETE ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
  }

  private async neynarGet(path: string): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, {
      headers: {
        accept: "application/json",
        "x-api-key": this.config.apiKey,
      },
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Neynar GET ${path} ${res.status}: ${err.slice(0, 300)}`);
    }
    return (await res.json()) as Record<string, unknown>;
  }

  private async neynarPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Neynar POST ${path} ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    }
    return json;
  }
}

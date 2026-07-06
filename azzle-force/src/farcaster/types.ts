export interface FarcasterCast {
  hash: string;
  authorFid: number;
  authorUsername: string;
  text: string;
  channelId: string | null;
  timestamp: string;
  parentHash: string | null;
  likes: number;
  replies: number;
}

export function castEntityName(cast: FarcasterCast): string {
  const user = cast.authorUsername ? `@${cast.authorUsername}` : `fid:${cast.authorFid}`;
  return `fc:${user}: ${cast.text.slice(0, 80)}`;
}

export function castMetadata(cast: FarcasterCast): Record<string, unknown> {
  return {
    farcaster: {
      hash: cast.hash,
      author_fid: cast.authorFid,
      author_username: cast.authorUsername,
      text: cast.text.slice(0, 2000),
      channel_id: cast.channelId,
      timestamp: cast.timestamp,
      parent_hash: cast.parentHash,
      likes: cast.likes,
      replies: cast.replies,
    },
    contact_methods: [`farcaster:fid:${cast.authorFid}`],
  };
}

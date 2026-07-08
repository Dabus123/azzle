import type { FarcasterRateLimits } from "./config.js";

export interface FarcasterOutreachRow {
  channel?: string;
  status?: string;
  created_at?: string | Date;
  sent_at?: string | Date | null;
}

const MS_MIN = 60_000;

export const FARCASTER_ACTION_CHANNELS = {
  cast: "farcaster_cast",
  reply: "farcaster_reply",
  like: "farcaster_like",
} as const;

export type FarcasterAction = keyof typeof FARCASTER_ACTION_CHANNELS;

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function canFarcasterAction(
  rows: FarcasterOutreachRow[],
  action: FarcasterAction,
  limits: FarcasterRateLimits,
  now = Date.now()
): { ok: boolean; reason?: string } {
  const channel = FARCASTER_ACTION_CHANNELS[action];
  const fcRows = rows.filter((r) => r.status === "sent" && r.channel === channel);

  if (fcRows.length > 0) {
    const last = fcRows.reduce((a, b) => {
      const ta = new Date(String(a.sent_at ?? a.created_at ?? 0)).getTime();
      const tb = new Date(String(b.sent_at ?? b.created_at ?? 0)).getTime();
      return tb > ta ? b : a;
    });
    const lastAt = new Date(String(last.sent_at ?? last.created_at ?? 0)).getTime();
    const gapMin = (now - lastAt) / MS_MIN;
    if (gapMin < limits.minMinutesBetweenActions) {
      return {
        ok: false,
        reason: `cooldown_${Math.ceil(limits.minMinutesBetweenActions - gapMin)}m`,
      };
    }
  }

  const day = utcDayKey(new Date(now));
  const today = fcRows.filter((r) => {
    const t = new Date(String(r.sent_at ?? r.created_at ?? 0));
    return utcDayKey(t) === day;
  });

  if (action === "cast" && today.length >= limits.maxCastsPerDay) {
    return { ok: false, reason: `cast_daily_cap_${limits.maxCastsPerDay}` };
  }
  if (action === "reply" && today.length >= limits.maxRepliesPerDay) {
    return { ok: false, reason: `reply_daily_cap_${limits.maxRepliesPerDay}` };
  }
  if (action === "like" && today.length >= limits.maxLikesPerDay) {
    return { ok: false, reason: `like_daily_cap_${limits.maxLikesPerDay}` };
  }

  return { ok: true };
}

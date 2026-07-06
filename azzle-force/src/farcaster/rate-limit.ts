import type { FarcasterRateLimits } from "./config.js";

export interface FarcasterOutreachRow {
  channel?: string;
  status?: string;
  created_at?: string | Date;
  sent_at?: string | Date | null;
}

const MS_MIN = 60_000;
const MS_DAY = 86_400_000;

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function canFarcasterAction(
  rows: FarcasterOutreachRow[],
  action: "cast" | "reply",
  limits: FarcasterRateLimits,
  now = Date.now()
): { ok: boolean; reason?: string } {
  const fcRows = rows.filter(
    (r) =>
      r.status === "sent" &&
      (r.channel === "farcaster_cast" || r.channel === "farcaster_reply")
  );

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

  const castsToday = today.filter((r) => r.channel === "farcaster_cast").length;
  const repliesToday = today.filter((r) => r.channel === "farcaster_reply").length;

  if (action === "cast" && castsToday >= limits.maxCastsPerDay) {
    return { ok: false, reason: `cast_daily_cap_${limits.maxCastsPerDay}` };
  }
  if (action === "reply" && repliesToday >= limits.maxRepliesPerDay) {
    return { ok: false, reason: `reply_daily_cap_${limits.maxRepliesPerDay}` };
  }

  return { ok: true };
}

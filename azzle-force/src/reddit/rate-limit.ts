import type { RedditRateLimits } from "./config.js";

export interface RedditOutreachRow {
  channel?: string;
  status?: string;
  created_at?: string | Date;
  sent_at?: string | Date | null;
}

const MS_MIN = 60_000;
const MS_HOUR = 3_600_000;
const MS_DAY = 86_400_000;

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function canRedditAction(
  rows: RedditOutreachRow[],
  action: "comment" | "post",
  limits: RedditRateLimits,
  now = Date.now()
): { ok: boolean; reason?: string } {
  const redditRows = rows.filter(
    (r) =>
      r.status === "sent" &&
      (r.channel === "reddit_comment" || r.channel === "reddit_post")
  );

  if (redditRows.length > 0) {
    const last = redditRows.reduce((a, b) => {
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

  const hourAgo = now - MS_HOUR;
  const commentsLastHour = redditRows.filter((r) => {
    if (r.channel !== "reddit_comment") return false;
    const t = new Date(String(r.sent_at ?? r.created_at ?? 0)).getTime();
    return t >= hourAgo;
  }).length;

  if (action === "comment" && commentsLastHour >= limits.maxCommentsPerHour) {
    return { ok: false, reason: `comment_hourly_cap_${limits.maxCommentsPerHour}` };
  }

  const day = utcDayKey(new Date(now));
  const postsToday = redditRows.filter((r) => {
    if (r.channel !== "reddit_post") return false;
    const t = new Date(String(r.sent_at ?? r.created_at ?? 0));
    return utcDayKey(t) === day;
  }).length;

  if (action === "post" && postsToday >= limits.maxPostsPerDay) {
    return { ok: false, reason: `post_daily_cap_${limits.maxPostsPerDay}` };
  }

  return { ok: true };
}

export function threadAgeHours(createdUtc: number, now = Date.now()): number {
  return (now / 1000 - createdUtc) / 3600;
}

export function isThreadEligible(
  thread: { score: number; createdUtc: number },
  limits: RedditRateLimits,
  now = Date.now()
): boolean {
  if (thread.score < limits.minThreadScore) return false;
  const age = threadAgeHours(thread.createdUtc, now);
  return age >= 0 && age <= limits.maxThreadAgeHours;
}

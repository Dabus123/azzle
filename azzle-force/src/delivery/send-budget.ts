/** Resend free tier is ~100/day — avoid retry storms that mark every draft send_failed. */

const MS_DAY = 86_400_000;

let quotaPausedUntil = 0;

export function dailyEmailCap(): number {
  const n = Number(process.env.OUTREACH_DAILY_EMAIL_CAP ?? "90");
  return Number.isFinite(n) && n > 0 ? n : 90;
}

export function isQuotaPaused(now = Date.now()): boolean {
  return now < quotaPausedUntil;
}

export function pauseForQuota(reason: string): void {
  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);
  quotaPausedUntil = tomorrow.getTime();
  console.warn(
    `[delivery] email quota hit — pausing sends until ${tomorrow.toISOString()} (${reason})`
  );
}

export function isQuotaError(message: string): boolean {
  return /429|daily.?quota|rate.?limit|send budget exhausted|daily_cap_/i.test(message);
}

export function utcDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface OutreachSendRow {
  status: string;
  channel?: string;
  sent_at?: string | Date | null;
  created_at?: string | Date;
}

/** Count email sends logged today (sent status only). */
export function countSendsToday(rows: OutreachSendRow[], now = new Date()): number {
  const day = utcDayKey(now);
  let n = 0;
  for (const row of rows) {
    if (row.status !== "sent") continue;
    if (row.channel && row.channel !== "email") continue;
    const ts = row.sent_at ?? row.created_at;
    if (!ts) continue;
    if (utcDayKey(new Date(String(ts))) === day) n++;
  }
  return n;
}

export function canSendEmailToday(
  allOutreachRows: OutreachSendRow[],
  now = Date.now()
): { ok: boolean; reason?: string; sentToday: number; cap: number } {
  const cap = dailyEmailCap();
  const sentToday = countSendsToday(allOutreachRows, new Date(now));

  if (isQuotaPaused(now)) {
    return { ok: false, reason: "quota_paused_until_tomorrow", sentToday, cap };
  }
  if (sentToday >= cap) {
    return { ok: false, reason: `daily_cap_${cap}`, sentToday, cap };
  }
  return { ok: true, sentToday, cap };
}

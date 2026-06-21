/** Block bot, noreply, and CI emails from outreach. */

const BLOCKED_EMAIL_PATTERNS = [
  /noreply/i,
  /no-reply/i,
  /users\.noreply\.github/i,
  /@bot\.com$/i,
  /\[bot\]/i,
  /dependabot/i,
  /github-actions/i,
  /autopush@/i,
  /walle@/i,
  /greenkeeper/i,
  /renovate/i,
  /sentry/i,
  /@local$/i,
  /example\.com$/i,
];

export function isSendableEmail(email: string): boolean {
  const s = email.trim().toLowerCase();
  if (!s.includes("@") || s.length < 5) return false;
  return !BLOCKED_EMAIL_PATTERNS.some((p) => p.test(s));
}

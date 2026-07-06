/** Block bot, noreply, and CI emails from outreach. */

const BLOCKED_EMAIL_PATTERNS = [
  /noreply/i,
  /no-reply/i,
  /users\.noreply\.github/i,
  /@bot[.\-]/i,
  /^bot@/i,
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
  /test@test/i,
  /foo@bar/i,
];

/** TLD must be 2+ alpha chars — blocks LLM-invented domains like bot@mlb-data */
const VALID_EMAIL =
  /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,})+$/i;

export function isSendableEmail(email: string): boolean {
  const s = email.trim().toLowerCase();
  if (!VALID_EMAIL.test(s) || s.length < 6) return false;
  return !BLOCKED_EMAIL_PATTERNS.some((p) => p.test(s));
}

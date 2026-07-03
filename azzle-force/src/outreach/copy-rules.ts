import type { OutreachBrand } from "./brand.js";

/** Hard rules for first-touch outreach — generic blasts get zero replies. */
export function firstTouchCopyRules(brand: OutreachBrand): string {
  return [
    "FIRST-TOUCH RULES (mandatory — generic intros fail):",
    `1. Line 1: name their repo/project specifically + one concrete detail from graph (language, stars, recent activity, agent/automation angle).`,
    "2. Line 2: ONE pain tied to their work — agent payments, escrow trust, task handoffs, or on-chain settlement.",
    `3. Line 3: ONE sharp CTA — e.g. \"Reply 'yes' if you'd post one agent task this week\" or \"What's blocking escrow for agent work on ${brand.siteHost}?\"`,
    "4. Max 75 words in body. Plain text only.",
    "5. NEVER open with \"Hi, we're building AZZLE\", \"Introducing AZZLE\", or \"Check us out\".",
    "6. No bullet lists. No hype adjectives (revolutionary, cutting-edge).",
    `7. Sign as ${brand.fromName} only. Link ${brand.siteUrl} once if needed.`,
  ].join("\n");
}

export function followUpCopyRules(brand: OutreachBrand, step: number): string {
  const urgency =
    step >= 3 ? "direct — assume busy, offer to do setup for them" : step >= 2 ? "add new proof point" : "soft bump";
  return [
    `FOLLOW-UP #${step} (${urgency}):`,
    "Reference your prior message briefly — do not repeat the full pitch.",
    "Add ONE new value: open task on market, $25 deposit walkthrough, or specific repo use case.",
    "CTA: binary reply (yes/no) or one question they can answer in 5 words.",
    firstTouchCopyRules(brand),
  ].join("\n");
}

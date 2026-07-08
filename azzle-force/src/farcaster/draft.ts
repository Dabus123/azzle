import { z } from "zod";
import type { ForceContext } from "../context.js";
import { loadFarcasterConfig } from "./config.js";
import { outreachBrandRules } from "../outreach/brand.js";
import { productMarketingPromptBlock } from "../outreach/product-marketing.js";

export const FarcasterCastDraftSchema = z.object({
  text: z.string().default(""),
  include_link: z.boolean().default(true),
});

export const FarcasterReplyDraftSchema = z.object({
  text: z.string().default(""),
  /** Embed the interactive Snap (poll + Human Terminal) — default yes. */
  include_snap: z.boolean().default(true),
});

export type FarcasterCastDraft = z.infer<typeof FarcasterCastDraftSchema>;
export type FarcasterReplyDraft = z.infer<typeof FarcasterReplyDraftSchema>;

const MAX_LEN = 320;

export async function draftFarcasterCast(
  ctx: ForceContext,
  facts: Record<string, unknown>
): Promise<FarcasterCastDraft> {
  const cfg = loadFarcasterConfig();
  const brand = ctx.config.outreachBrand;
  const style = String(facts.post_style ?? "use_case_explainer");
  const styleRules =
    style === "use_case_explainer"
      ? [
          "Goal: teach one concrete AZZLE use case — interesting explainer, not a sales pitch.",
          "Use use_case_hook + use_case_scenario as inspiration; rewrite in your own words.",
          "Sound like a dev who shipped something weird and useful, not marketing.",
          facts.embed_url === facts.site_url
            ? "This cast embeds azzle.org — the text must stand alone as a compelling use-case story."
            : "This cast embeds a snap/miniapp — mention the scenario; don't hard-sell the product.",
        ]
      : ["Write a short launch note — still concrete, not hype."];

  const recent = Array.isArray(facts.recent_casts) ? facts.recent_casts : [];
  const system = [
    "You are Farcaster Poster in AZZLE FORCE swarm.",
    "Write a single cast for Base/crypto builder audience.",
    productMarketingPromptBlock(),
    ...styleRules,
    ...cfg.castRules,
    outreachBrandRules(brand),
    recent.length > 0
      ? `Recent casts to NOT repeat or paraphrase:\n${recent.map((c) => `- ${c}`).join("\n")}`
      : "",
    "Return JSON: { text: string, include_link: boolean }.",
    "Set include_link true when the cast should append the site URL (usually yes for azzle.org embeds).",
    `Hard limit: ${MAX_LEN} characters for final text (URL added separately if include_link).`,
    "Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  return ctx.llm.completeJson("medium", system, facts, FarcasterCastDraftSchema) as Promise<FarcasterCastDraft>;
}

export function formatSnapReplyText(text: string, fallback?: string): string {
  let t = (text || fallback || "").replace(/\s+/g, " ").trim();
  if (!t) return "";

  // Professional polish: capitalize first letter after leading emoji/punctuation
  const emojiLead = /^(\p{Extended_Pictographic}+\s*)/u.exec(t);
  const lead = emojiLead?.[1] ?? "";
  const rest = t.slice(lead.length);
  if (rest.length > 0) {
    t = lead + rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  const emojiCount = (t.match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emojiCount === 0) t = `✨ ${t}`;
  if (emojiCount > 3) {
    let kept = 0;
    t = [...t]
      .filter((ch) => {
        if (!/\p{Extended_Pictographic}/u.test(ch)) return true;
        kept++;
        return kept <= 2;
      })
      .join("");
  }

  return t.slice(0, MAX_LEN);
}

export async function draftFarcasterReply(
  ctx: ForceContext,
  facts: Record<string, unknown>
): Promise<FarcasterReplyDraft> {
  const cfg = loadFarcasterConfig();
  const brand = ctx.config.outreachBrand;
  const snapUrl = String(facts.snap_url ?? "");
  const system = [
    "You are Farcaster Replier for AZZLE — professional, warm, and precise with builders.",
    "Invite them into the interactive Snap embed (poll + Human Terminal) — never a generic pitch.",
    "",
    "The Snap experience:",
    "- Live poll: 'Still prompting' vs 'Went agentic' (confetti on vote)",
    "- Real-time progress bar",
    "- Human Terminal mini app launch",
    "",
    "Voice & format:",
    "- Professional: complete sentences, confident, respectful — no slang, no hype words.",
    "- Use exactly 1–2 relevant emojis (e.g. ✨ 🎯 👀 🔥). Place at the start or before the CTA.",
    "- Structure: [emoji] Acknowledge their point in one crisp sentence. Then a clear CTA: tap the embed → vote → try the terminal.",
    "- Mirror one specific detail from parent_cast — prove you read it.",
    "",
    productMarketingPromptBlock(),
    ...cfg.replyRules,
    outreachBrandRules(brand),
    snapUrl
      ? "Embeds are attached automatically — never paste URLs in text."
      : "",
    "Return JSON: { text: string, include_snap: boolean }.",
    "include_snap: true (default) for builder/tech casts.",
    `Hard limit: ${MAX_LEN} characters. No URLs in text.`,
    "Output valid JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  return ctx.llm.completeJson("medium", system, facts, FarcasterReplyDraftSchema) as Promise<FarcasterReplyDraft>;
}

export function finalizeCastText(
  draft: { text?: string; include_link?: boolean },
  siteUrl: string,
  fallbackText?: string
): string {
  let text = (draft.text ?? "").trim();
  if (!text && fallbackText?.trim()) text = fallbackText.trim();
  if (draft.include_link && siteUrl && !text.includes(siteUrl)) {
    const room = MAX_LEN - siteUrl.length - 1;
    if (text.length > room) text = text.slice(0, room - 1) + "…";
    text = `${text} ${siteUrl}`.trim();
  }
  return text.slice(0, MAX_LEN);
}

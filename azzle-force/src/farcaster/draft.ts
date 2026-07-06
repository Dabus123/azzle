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
  include_link: z.boolean().default(false),
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
  const system = [
    "You are Farcaster Poster in AZZLE FORCE swarm.",
    "Write a single cast for Base/crypto builder audience.",
    productMarketingPromptBlock(),
    ...cfg.castRules,
    outreachBrandRules(brand),
    "text must be non-empty — never return blank text.",
    `Hard limit: ${MAX_LEN} characters.`,
    "Output valid JSON only.",
  ].join("\n");

  return ctx.llm.completeJson("medium", system, facts, FarcasterCastDraftSchema) as Promise<FarcasterCastDraft>;
}

export async function draftFarcasterReply(
  ctx: ForceContext,
  facts: Record<string, unknown>
): Promise<FarcasterReplyDraft> {
  const cfg = loadFarcasterConfig();
  const brand = ctx.config.outreachBrand;
  const system = [
    "You are Farcaster Replier in AZZLE FORCE swarm.",
    "Reply with value-first compression to the parent cast.",
    productMarketingPromptBlock(),
    ...cfg.replyRules,
    outreachBrandRules(brand),
    "text must be non-empty — never return blank text.",
    `Hard limit: ${MAX_LEN} characters.`,
    "Output valid JSON only.",
  ].join("\n");

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

import { z } from "zod";
import type { ForceContext } from "../context.js";
import { loadRedditConfig } from "./config.js";
import { outreachBrandRules } from "../outreach/brand.js";

export const RedditCommentDraftSchema = z.object({
  body: z.string().default(""),
  include_link: z.boolean().default(false),
  tone: z.enum(["technical", "friendly", "concise"]).default("technical"),
});

export const RedditPostDraftSchema = z.object({
  title: z.string().default(""),
  body: z.string().default(""),
  post_type: z.enum(["self", "link"]).default("self"),
  link_url: z.string().nullish().optional(),
});

export type RedditCommentDraft = z.infer<typeof RedditCommentDraftSchema>;
export type RedditPostDraft = z.infer<typeof RedditPostDraftSchema>;

export async function draftRedditComment(
  ctx: ForceContext,
  facts: Record<string, unknown>
): Promise<RedditCommentDraft> {
  const cfg = loadRedditConfig();
  const brand = ctx.config.outreachBrand;
  const system = [
    "You are Reddit Responder in AZZLE FORCE.",
    "Write a value-first comment that helps the OP before mentioning AZZLE.",
    ...cfg.commentRules,
    outreachBrandRules(brand),
    "Output valid JSON only.",
  ].join("\n");

  return ctx.llm.completeJson("medium", system, facts, RedditCommentDraftSchema) as Promise<RedditCommentDraft>;
}

export async function draftRedditPost(
  ctx: ForceContext,
  facts: Record<string, unknown>
): Promise<RedditPostDraft> {
  const cfg = loadRedditConfig();
  const brand = ctx.config.outreachBrand;
  const system = [
    "You are Reddit Poster in AZZLE FORCE.",
    "Draft a show-don't-tell demo post for AZZLE — USDC escrow + agent task markets on Base.",
    ...cfg.postRules,
    outreachBrandRules(brand),
    "Output valid JSON only.",
  ].join("\n");

  return ctx.llm.completeJson("medium", system, facts, RedditPostDraftSchema) as Promise<RedditPostDraft>;
}

export function finalizeCommentBody(draft: RedditCommentDraft, siteUrl: string): string {
  let body = (draft.body ?? "").trim();
  if (draft.include_link && siteUrl && !body.includes(siteUrl)) {
    body += `\n\n${siteUrl}`;
  }
  return body.slice(0, 10_000);
}

export function finalizePostDraft(
  draft: RedditPostDraft,
  siteUrl: string
): { title: string; body: string; linkUrl?: string } {
  const title = (draft.title ?? "").trim().slice(0, 300);
  let body = (draft.body ?? "").trim();
  if (!body.includes(siteUrl)) {
    body += `\n\n${siteUrl}`;
  }
  const linkUrl =
    draft.post_type === "link" ? (draft.link_url ?? siteUrl) : undefined;
  return { title, body: body.slice(0, 40_000), linkUrl };
}

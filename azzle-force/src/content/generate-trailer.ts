import type { ForceContext } from "../context.js";
import { loadOutreachBrand, outreachBrandRules } from "../outreach/brand.js";
import { VideoTimelineSchema, type VideoTimeline } from "./video-types.js";
import { renderTrailer, type RenderTrailerResult } from "./video-engine.js";
import { heuristicTimeline } from "./video-frame-renderer.js";
import {
  normalizeTimelineResponse,
  timelineDefaults,
  timelineSchemaExample,
} from "./video-timeline-normalize.js";
import { composeMPSASystemPrompt, mpsaConfigExists } from "../brain/mpsa.js";
import { getAgentPromptExtra } from "../brain/playbook.js";
import { styleLlmRules } from "./style-direction.js";

const AGENT_ID = "content-studio";

export async function generateTrailerBundle(
  ctx: ForceContext,
  opts?: { topic?: string; source?: string; duration_sec?: number }
): Promise<RenderTrailerResult> {
  const topic = opts?.topic?.trim() || "AZZLE — autonomous agents earning USDC on Base task markets";

  let timeline = await llmTimeline(ctx, topic, opts?.duration_sec);

  if (opts?.duration_sec) timeline.duration_sec = opts.duration_sec;

  return renderTrailer(timeline, { topic, source: opts?.source ?? AGENT_ID });
}

async function llmTimeline(
  ctx: ForceContext,
  topic: string,
  durationSec?: number
): Promise<VideoTimeline> {
  const brand = loadOutreachBrand();
  const styleRules = styleLlmRules();
  const example = timelineSchemaExample(topic);
  if (durationSec) example.duration_sec = durationSec;

  const extraRules = [
    outreachBrandRules(brand),
    "You are a CODE-BASED VIDEO GENERATOR. Output ONE JSON object (not an array).",
    "Required keys: title, duration_sec, fps, width, height, palette, actions, tweet_caption.",
    "Each action: type (text|glow|line|rect), start, end, x, y — optional content, font_size, color, fill, radius.",
    "Do NOT use timestamp/action_type/coordinates — use start, end, type, x, y, content.",
    "duration_sec: 6-12. fps: 30. width: 1920. height: 1080.",
    durationSec ? `duration_sec: ${durationSec}` : "",
    "Stagger start/end for motion. Neon-void palette. At least 2 glow actions.",
    "tweet_caption: X-ready, under 280 chars.",
    styleRules,
  ]
    .filter(Boolean)
    .join("\n");

  let system: string;
  if (mpsaConfigExists()) {
    ({ system } = composeMPSASystemPrompt({
      agentId: AGENT_ID,
      agentName: "Trailer Studio",
      mission: "Generate branded trailer videos via JSON timeline + code renderer + FFmpeg.",
      playbookExtra: getAgentPromptExtra(AGENT_ID),
      taskRules: extraRules,
    }));
  } else {
    system = ["You are Trailer Studio in AZZLE FORCE.", extraRules].join("\n");
  }

  const defaults = timelineDefaults(topic);
  if (durationSec) defaults.duration_sec = durationSec;

  const timeline = await ctx.llm.completeJson(
    "medium",
    system,
    { topic, site: brand.siteUrl, site_host: brand.siteHost },
    VideoTimelineSchema,
    {
      defaults,
      schemaExample: example,
      normalize: (data) => normalizeTimelineResponse(data, topic),
    }
  );

  const parsed = VideoTimelineSchema.safeParse(timeline);
  if (parsed.success) return parsed.data;

  console.warn(`[${AGENT_ID}] timeline validation after LLM — heuristic fallback`);
  return heuristicTimeline(topic);
}

import { heuristicTimeline } from "./video-frame-renderer.js";

const ACTION_TYPES = new Set(["text", "glow", "line", "rect"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickNumber(...vals: unknown[]): number | undefined {
  for (const v of vals) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

function mapActionType(raw: unknown): string | undefined {
  const t = String(raw ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const aliases: Record<string, string> = {
    text: "text",
    text_overlay: "text",
    label: "text",
    headline: "text",
    title: "text",
    glow: "glow",
    orb: "glow",
    circle: "glow",
    line: "line",
    rule: "line",
    rect: "rect",
    rectangle: "rect",
    box: "rect",
    shape: "rect",
  };
  const mapped = aliases[t];
  return mapped && ACTION_TYPES.has(mapped) ? mapped : undefined;
}

function normalizeAction(raw: unknown, durationSec: number): Record<string, unknown> | null {
  const a = asRecord(raw);
  if (!a) return null;

  const type = mapActionType(a.type ?? a.action_type ?? a.action);
  if (!type) return null;

  const coords = asRecord(a.coordinates) ?? asRecord(a.position) ?? asRecord(a.pos);
  const x = pickNumber(a.x, coords?.x, coords?.left) ?? 0;
  const y = pickNumber(a.y, coords?.y, coords?.top) ?? 0;
  const x2 = pickNumber(a.x2, coords?.x2, coords?.right);
  const y2 = pickNumber(a.y2, coords?.y2, coords?.bottom);

  const ts = pickNumber(a.start, a.timestamp, a.t, a.time);
  const dur = pickNumber(a.duration, a.length);
  let start = ts ?? 0;
  let end = pickNumber(a.end, a.end_time, a.until);
  if (end === undefined && dur !== undefined) end = start + dur;
  if (end === undefined) end = Math.min(durationSec, start + 2.5);
  if (end < start) end = start + 0.5;

  const content = pickString(a.content, a.text, a.label, a.value, a.string);

  const out: Record<string, unknown> = {
    type,
    start,
    end,
    x,
    y,
  };
  if (x2 !== undefined) out.x2 = x2;
  if (y2 !== undefined) out.y2 = y2;
  if (content) out.content = content;
  if (a.font_size !== undefined) out.font_size = pickNumber(a.font_size);
  if (a.color !== undefined) out.color = a.color;
  if (a.fill !== undefined) out.fill = a.fill;
  if (a.opacity !== undefined) out.opacity = pickNumber(a.opacity);
  if (a.radius !== undefined) out.radius = pickNumber(a.radius);

  return out;
}

function normalizeActions(raw: unknown, durationSec: number): Record<string, unknown>[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: Record<string, unknown>[] = [];
  for (const item of list) {
    const action = normalizeAction(item, durationSec);
    if (action) out.push(action);
  }
  return out;
}

/** Map common LLM response shapes → VideoTimeline fields. */
export function normalizeTimelineResponse(data: unknown, topic: string): Record<string, unknown> {
  const defaults = heuristicTimeline(topic) as unknown as Record<string, unknown>;

  if (Array.isArray(data)) {
    return {
      ...defaults,
      actions: normalizeActions(data, Number(defaults.duration_sec ?? 8)),
    };
  }

  const root = asRecord(data);
  if (!root) return defaults;

  const nested =
    asRecord(root.timeline) ??
    asRecord(root.video) ??
    asRecord(root.trailer) ??
    asRecord(root.spec) ??
    asRecord(root.data);

  const src = nested ? { ...root, ...nested } : root;

  const durationSec = pickNumber(src.duration_sec, src.duration, src.length) ?? Number(defaults.duration_sec ?? 8);

  const title = pickString(
    src.title,
    src.headline,
    src.name,
    src.hook,
    typeof src.text === "string" ? src.text : undefined
  );

  const tweet_caption = pickString(
    src.tweet_caption,
    src.caption,
    src.tweet,
    src.social_caption,
    src.post_caption
  );

  const rawActions =
    src.actions ??
    src.scenes ??
    src.steps ??
    src.visual_actions ??
    src.elements ??
    src.frames;

  let actions = normalizeActions(rawActions, durationSec);
  if (actions.length === 0 && Array.isArray(src.timeline)) {
    actions = normalizeActions(src.timeline, durationSec);
  }

  const palette = asRecord(src.palette) ?? asRecord(src.colors);

  const out: Record<string, unknown> = {
    ...defaults,
    ...src,
    duration_sec: durationSec,
    fps: pickNumber(src.fps, src.frame_rate) ?? defaults.fps,
    width: pickNumber(src.width) ?? defaults.width,
    height: pickNumber(src.height) ?? defaults.height,
  };

  if (title) out.title = title.slice(0, 80);
  if (pickString(src.subtitle)) out.subtitle = pickString(src.subtitle, src.tagline)?.slice(0, 140);
  if (pickString(src.cta)) out.cta = pickString(src.cta)?.slice(0, 48);
  if (tweet_caption) out.tweet_caption = tweet_caption.slice(0, 280);
  if (actions.length > 0) out.actions = actions;
  if (palette) out.palette = { ...(defaults.palette as object), ...palette };

  return out;
}

export function timelineDefaults(topic: string): Record<string, unknown> {
  return normalizeTimelineResponse({}, topic);
}

export function timelineSchemaExample(topic: string): Record<string, unknown> {
  const t = heuristicTimeline(topic);
  return {
    title: t.title,
    subtitle: t.subtitle,
    cta: t.cta,
    duration_sec: t.duration_sec,
    fps: t.fps,
    width: t.width,
    height: t.height,
    palette: t.palette,
    actions: t.actions.slice(0, 4).map((a) => ({ ...a })),
    tweet_caption: t.tweet_caption,
  };
}

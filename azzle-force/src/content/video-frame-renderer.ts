import sharp from "sharp";
import type { VideoAction, VideoTimeline } from "./video-types.js";
import { loadOutreachBrand } from "../outreach/brand.js";
import { themePalette } from "./style-direction.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function actionProgress(action: VideoAction, t: number): number {
  if (t < action.start || t > action.end) return 0;
  const span = Math.max(0.001, action.end - action.start);
  const local = (t - action.start) / span;
  const fade = Math.min(1, local * 4, (1 - local) * 4 + 0.25);
  return fade * (action.opacity ?? 1);
}

function neonBackground(w: number, h: number, p: VideoTimeline["palette"], t: number): string {
  const pulse = 0.85 + 0.15 * Math.sin(t * 2.1);
  return `
    <rect width="${w}" height="${h}" fill="${p.background}"/>
    <circle cx="${w * 0.82}" cy="${h * 0.18}" r="${h * 0.45 * pulse}" fill="${p.glow}" opacity="0.32"/>
    <circle cx="${w * 0.12}" cy="${h * 0.78}" r="${h * 0.32}" fill="${p.accent}" opacity="0.24"/>
    <circle cx="${w * 0.55}" cy="${h * 0.52}" r="${h * 0.22}" fill="${p.secondary}" opacity="0.14"/>
    <ellipse cx="${w * 0.5}" cy="${h * 0.5}" rx="${w * 0.55}" ry="${h * 0.3}" fill="none" stroke="${p.glow}" stroke-width="2" opacity="0.1"/>
  `;
}

function renderActions(actions: VideoAction[], t: number, w: number, h: number): string {
  const parts: string[] = [];
  for (const a of actions) {
    const alpha = actionProgress(a, t);
    if (alpha <= 0.01) continue;

    if (a.type === "text" && a.content) {
      const fs = a.font_size ?? 48;
      parts.push(
        `<text x="${a.x}" y="${a.y}" font-family="Arial Black, Arial, sans-serif" font-size="${fs}" font-weight="700" fill="${a.color ?? "#fff"}" opacity="${alpha.toFixed(3)}">${esc(a.content)}</text>`
      );
    } else if (a.type === "glow") {
      const r = a.radius ?? 120;
      parts.push(
        `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="${a.fill ?? "#a855f7"}" opacity="${(alpha * 0.35).toFixed(3)}"/>`
      );
    } else if (a.type === "rect") {
      const x2 = a.x2 ?? a.x + 200;
      const y2 = a.y2 ?? a.y + 44;
      parts.push(
        `<rect x="${a.x}" y="${a.y}" width="${x2 - a.x}" height="${y2 - a.y}" rx="4" fill="${a.fill ?? "#ff2d9a"}" opacity="${(alpha * 0.2).toFixed(3)}" stroke="${a.color ?? "#ff2d9a"}" stroke-width="1" stroke-opacity="${(alpha * 0.4).toFixed(3)}"/>`
      );
    } else if (a.type === "line") {
      parts.push(
        `<line x1="${a.x}" y1="${a.y}" x2="${a.x2 ?? w}" y2="${a.y2 ?? a.y}" stroke="${a.color ?? "#00f0ff"}" stroke-width="3" opacity="${alpha.toFixed(3)}"/>`
      );
    }
  }
  return parts.join("\n");
}

/** Build SVG for one frame at time `t` (seconds). */
export function buildFrameSvg(timeline: VideoTimeline, t: number, brandDataUri?: string): string {
  const { width: w, height: h, palette: p } = timeline;
  const brand = loadOutreachBrand();
  const showBrand = t >= timeline.duration_sec * 0.55 && brandDataUri;

  const brandSvg = showBrand
    ? `<image href="${brandDataUri}" x="${w - 280}" y="48" width="220" height="52" preserveAspectRatio="xMidYMid meet" opacity="${Math.min(1, (t - timeline.duration_sec * 0.55) * 2).toFixed(3)}"/>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  ${neonBackground(w, h, p, t)}
  ${renderActions(timeline.actions, t, w, h)}
  ${brandSvg}
  <text x="56" y="${h - 48}" font-family="Arial, sans-serif" font-size="14" fill="${p.accent}" opacity="0.7">${esc(brand.siteHost)}</text>
</svg>`;
}

/** Render frame to raw RGBA bytes for FFmpeg pipe. */
export async function renderFrameRgba(
  timeline: VideoTimeline,
  frameIndex: number,
  brandDataUri?: string
): Promise<Buffer> {
  const t = frameIndex / timeline.fps;
  const svg = buildFrameSvg(timeline, t, brandDataUri);
  const { data, info } = await sharp(Buffer.from(svg))
    .resize(timeline.width, timeline.height)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== timeline.width || info.height !== timeline.height) {
    throw new Error(`frame size mismatch ${info.width}x${info.height}`);
  }
  return data;
}

export function heuristicTimeline(topic: string): VideoTimeline {
  const brand = loadOutreachBrand();
  const neon = themePalette("neon-void");
  const title = topic.length > 48 ? topic.slice(0, 45) + "…" : topic;
  const dur = 8;

  return {
    title: title.split(" ").slice(0, 6).join(" "),
    subtitle: topic,
    cta: brand.siteUrl,
    duration_sec: dur,
    fps: 30,
    width: 1920,
    height: 1080,
    palette: {
      background: neon.background,
      accent: neon.accent,
      glow: neon.glow,
      secondary: neon.secondary,
      text: "#ffffff",
    },
    actions: [
      { type: "glow", start: 0, end: dur, x: 1500, y: 200, radius: 280, fill: neon.glow },
      { type: "glow", start: 0, end: dur, x: 200, y: 800, radius: 200, fill: neon.accent },
      { type: "text", start: 0.4, end: dur - 0.5, x: 80, y: 420, content: title.split(" ").slice(0, 6).join(" "), font_size: 72, color: "#fff" },
      { type: "text", start: 1.2, end: dur - 0.5, x: 80, y: 520, content: topic.slice(0, 90), font_size: 32, color: "#e8d4ff", opacity: 0.9 },
      { type: "rect", start: 2.5, end: dur, x: 80, y: 580, x2: 420, y2: 624, fill: neon.accent, color: neon.accent },
      { type: "text", start: 2.6, end: dur, x: 100, y: 612, content: brand.siteHost, font_size: 22, color: neon.accent },
      { type: "line", start: 0, end: 1.5, x: 0, y: 4, x2: 1920, y2: 4, color: neon.accent },
    ],
    tweet_caption: `${topic} — agent task markets on Base. ${brand.siteUrl} #AZZLE #Base`,
  };
}

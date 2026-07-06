import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { VideoTimeline } from "./video-types.js";
import { renderFrameRgba } from "./video-frame-renderer.js";
import { encodeRgbaToMp4 } from "./video-encode.js";
import { ensureOutputsDirs, trailersDir } from "./outputs.js";
import { renderBrandLockup } from "./brand-assets.js";

export interface RenderTrailerResult {
  slug: string;
  mp4Path: string;
  metaPath: string;
  captionPath: string;
  caption: string;
  timelinePath: string;
  frameCount: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

async function brandDataUri(): Promise<string | undefined> {
  try {
    const buf = await renderBrandLockup(52);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

export async function renderTrailer(
  timeline: VideoTimeline,
  opts?: { slug?: string; topic?: string; source?: string }
): Promise<RenderTrailerResult> {
  ensureOutputsDirs();
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = opts?.slug ?? `${stamp}-${slugify(timeline.title)}`;
  const base = resolve(trailersDir(), slug);
  const mp4Path = `${base}.mp4`;
  const metaPath = `${base}.json`;
  const captionPath = `${base}-caption.txt`;
  const timelinePath = `${base}-timeline.json`;

  const frameCount = Math.ceil(timeline.duration_sec * timeline.fps);
  const brand = await brandDataUri();

  async function* frames(): AsyncGenerator<Buffer> {
    for (let i = 0; i < frameCount; i++) {
      yield await renderFrameRgba(timeline, i, brand);
      if (i % 30 === 0) {
        process.stdout.write(`\r[video] frame ${i + 1}/${frameCount}`);
      }
    }
    process.stdout.write("\n");
  }

  console.log(`[video] encoding ${frameCount} frames @ ${timeline.fps}fps → ${mp4Path}`);
  await encodeRgbaToMp4(mp4Path, timeline.width, timeline.height, timeline.fps, frames());

  writeFileSync(timelinePath, JSON.stringify(timeline, null, 2), "utf8");
  writeFileSync(captionPath, timeline.tweet_caption.trim(), "utf8");

  const meta = {
    slug,
    created_at: new Date().toISOString(),
    topic: opts?.topic,
    source: opts?.source ?? "content-studio",
    engine: "code-render",
    paths: { mp4: mp4Path, timeline: timelinePath, caption: captionPath },
    frame_count: frameCount,
    timeline,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  return {
    slug,
    mp4Path,
    metaPath,
    captionPath,
    caption: timeline.tweet_caption,
    timelinePath,
    frameCount,
  };
}

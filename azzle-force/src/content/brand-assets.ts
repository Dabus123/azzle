import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dir = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dir, "../..");

/** A mark only — `site/azzlelogo.png` (left half of wordmark canvas) */
export function logoMarkPath(): string {
  const custom = process.env.AZZLE_LOGO_MARK?.trim();
  if (custom) return resolve(custom);
  return resolve(PACKAGE_ROOT, "../site/azzlelogo.png");
}

/** Full wordmark fallback — `azzle-force/azzlelogo.png` */
export function logoWordmarkPath(): string {
  const custom = process.env.AZZLE_LOGO_ICON?.trim();
  if (custom) return resolve(custom);
  return resolve(PACKAGE_ROOT, "azzlelogo.png");
}

/** Stencil zze — `site/azzletype.png` (right half of wordmark canvas) */
export function logoTypePath(): string {
  const custom = process.env.AZZLE_LOGO_TYPE?.trim();
  if (custom) return resolve(custom);
  return resolve(PACKAGE_ROOT, "../site/azzletype.png");
}

export function brandAssetsReady(): boolean {
  return existsSync(logoMarkPath()) && existsSync(logoTypePath());
}

async function whiteFromLightMark(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    if (lum < 28) data[i + 3] = 0;
    else {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.min(255, Math.round(lum * 1.05));
    }
  }
  return sharp(Buffer.from(data), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

async function whiteFromDarkMark(input: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!;
    if (a < 8) {
      data[i + 3] = 0;
      continue;
    }
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = a;
  }
  return sharp(Buffer.from(data), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}

/** Where the A ends and zze begins on the 4116×2048 wordmark canvas. */
const WORDMARK_SPLIT = 0.535;

async function extractHalf(path: string, side: "left" | "right"): Promise<Buffer> {
  const meta = await sharp(path).metadata();
  const w = meta.width ?? 4116;
  const h = meta.height ?? 2048;
  const split = Math.round(w * WORDMARK_SPLIT);
  const region =
    side === "left"
      ? { left: 0, top: 0, width: split, height: h }
      : { left: split, top: 0, width: w - split, height: h };
  return sharp(path).extract(region).trim({ threshold: 12 }).png().toBuffer();
}

/** A mark + stencil zze — trimmed, bottom-aligned, tight gap. */
export async function renderBrandLockup(targetHeight: number): Promise<Buffer> {
  try {
    const iconRaw = await extractHalf(logoMarkPath(), "left");
    const typeRaw = await extractHalf(logoTypePath(), "right");

    const iconWhite = await whiteFromLightMark(iconRaw);
    const typeWhite = await whiteFromDarkMark(typeRaw);

    const iconResized = await sharp(iconWhite).resize({ height: targetHeight, fit: "inside" }).png().toBuffer();
    const iconW = (await sharp(iconResized).metadata()).width ?? targetHeight;
    const iconH = (await sharp(iconResized).metadata()).height ?? targetHeight;

    const typeH = Math.round(iconH * 0.56);
    const typeResized = await sharp(typeWhite).resize({ height: typeH, fit: "inside" }).png().toBuffer();
    const typeW = (await sharp(typeResized).metadata()).width ?? typeH * 2;
    const typeActualH = (await sharp(typeResized).metadata()).height ?? typeH;

    const gap = 1;
    const canvasW = iconW + gap + typeW;
    const canvasH = iconH;
    const typeY = canvasH - typeActualH;

    return sharp({
      create: {
        width: canvasW,
        height: canvasH,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        { input: iconResized, left: 0, top: 0 },
        { input: typeResized, left: iconW + gap, top: typeY },
      ])
      .png()
      .toBuffer();
  } catch {
    return renderFullWordmarkFallback(targetHeight);
  }
}

async function renderFullWordmarkFallback(targetHeight: number): Promise<Buffer> {
  const path = logoWordmarkPath();
  if (!existsSync(path)) throw new Error("No logo assets found");
  const white = await whiteFromLightMark(await sharp(path).trim({ threshold: 12 }).png().toBuffer());
  return sharp(white).resize({ height: targetHeight, fit: "inside" }).png().toBuffer();
}

export async function compositeBrandLockup(
  pngPath: string,
  canvasW: number,
  opts?: { height?: number; marginRight?: number; marginTop?: number }
): Promise<void> {
  if (!brandAssetsReady() && !existsSync(logoWordmarkPath())) return;

  const height = opts?.height ?? (canvasW >= 1000 ? 52 : 44);
  const marginRight = opts?.marginRight ?? 40;
  const marginTop = opts?.marginTop ?? 28;

  const lockup = await renderBrandLockup(height);
  const lockupW = (await sharp(lockup).metadata()).width ?? height * 3;
  const left = Math.max(0, canvasW - lockupW - marginRight);

  const tmp = `${pngPath}.brand.tmp.png`;
  await sharp(pngPath)
    .composite([{ input: lockup, left, top: marginTop }])
    .png()
    .toFile(tmp);

  const { renameSync } = await import("node:fs");
  renameSync(tmp, pngPath);
}

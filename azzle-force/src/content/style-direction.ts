import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface StyleDirection {
  version: number;
  active: boolean;
  id: string;
  name: string;
  default_theme: string;
  palette: {
    accent: string;
    glow: string;
    secondary: string;
    background: string;
  };
  subject: string;
  style: string;
  lighting: string;
  composition: string;
  atmosphere: string;
  technical: string;
  subject_template: string;
  llm_video_rules?: string[];
  llm_poster_rules?: string[];
}

export interface ThemePalette {
  accent: string;
  glow: string;
  secondary: string;
  background: string;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dir, "../../config/content/style-direction.json");

const FALLBACK_THEMES: Record<string, ThemePalette> = {
  cyan: { accent: "#00f0ff", glow: "#5ce1e6", secondary: "#b8ff57", background: "#0a0e27" },
  lime: { accent: "#b8ff57", glow: "#45eba5", secondary: "#00f0ff", background: "#0a0e27" },
  orange: { accent: "#e8640a", glow: "#ff9f43", secondary: "#ffd166", background: "#0a0e27" },
  purple: { accent: "#a78bfa", glow: "#c084fc", secondary: "#00f0ff", background: "#0a0e27" },
  "neon-void": { accent: "#ff2d9a", glow: "#a855f7", secondary: "#39ff14", background: "#120818" },
};

let cached: StyleDirection | null | undefined;

function stylePath(): string {
  return process.env.AZZLE_STYLE_DIRECTION?.trim() || DEFAULT_PATH;
}

export function loadStyleDirection(force = false): StyleDirection | null {
  if (cached !== undefined && !force) return cached;

  const path = stylePath();
  if (!existsSync(path)) {
    cached = null;
    return null;
  }

  try {
    cached = JSON.parse(readFileSync(path, "utf8")) as StyleDirection;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export function styleDirectionActive(): boolean {
  if (process.env.AZZLE_STYLE_DIRECTION_OFF === "true") return false;
  const sd = loadStyleDirection();
  return Boolean(sd?.active);
}

function videoRules(sd: StyleDirection): string[] {
  return sd.llm_video_rules ?? sd.llm_poster_rules ?? [];
}

export function styleLlmRules(): string {
  const sd = loadStyleDirection();
  if (!sd?.active) return "";
  return [
    `Active visual style direction: ${sd.name} (${sd.id}).`,
    ...videoRules(sd),
    `Style reference — Subject: ${sd.subject}`,
    `Style: ${sd.style}`,
    `Lighting: ${sd.lighting}`,
  ].join("\n");
}

export function themePalette(theme: string): ThemePalette {
  const sd = loadStyleDirection();
  if (sd?.active && theme === sd.default_theme) {
    return sd.palette;
  }
  return FALLBACK_THEMES[theme] ?? FALLBACK_THEMES.cyan!;
}

export function styleMeta(): Record<string, string> | null {
  const sd = loadStyleDirection();
  if (!sd?.active) return null;
  return { id: sd.id, name: sd.name, default_theme: sd.default_theme };
}

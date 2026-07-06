import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dir, "../..");

/** Root for generated assets — override with AZZLE_OUTPUTS_DIR */
export function outputsRoot(): string {
  const custom = process.env.AZZLE_OUTPUTS_DIR?.trim();
  return custom ? resolve(custom) : resolve(PACKAGE_ROOT, "outputs");
}

export function trailersDir(): string {
  return resolve(outputsRoot(), "trailers");
}

export function ensureOutputsDirs(): void {
  for (const dir of [outputsRoot(), trailersDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

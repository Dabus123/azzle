import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let cached = null;

export function loadManifest() {
  if (cached) return cached;
  try {
    cached = JSON.parse(readFileSync(join(__dirname, "contracts.json"), "utf8"));
    return cached;
  } catch {
    return null;
  }
}

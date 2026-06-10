import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load base-8453.json relative to a module URL (Node 18+ compatible). */
export function loadManifest(moduleUrl, ...pathSegments) {
  const base = dirname(fileURLToPath(moduleUrl));
  const file = join(base, ...pathSegments);
  return JSON.parse(readFileSync(file, "utf8"));
}

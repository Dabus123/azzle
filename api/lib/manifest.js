import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

let bundledManifest = null;
try {
  bundledManifest = require("../../contracts/deployments/base-8453.json");
} catch {
  /* load from disk at runtime (local dev) */
}

export function loadManifest() {
  if (bundledManifest) return bundledManifest;
  const path = join(process.cwd(), "contracts", "deployments", "base-8453.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

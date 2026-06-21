/**
 * Scan all lite graph files and report best recoverable state.
 * Usage: node scripts/recover-graph.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const liteDir = resolve(root, ".azzle-force-lite");

function scanFile(fp) {
  if (!existsSync(fp)) return null;
  const raw = readFileSync(fp, "utf8").trim();
  if (!raw) return { path: fp, bytes: 0, parseOk: false, entities: 0, scores: 0 };
  try {
    const d = JSON.parse(raw);
    return {
      path: fp,
      bytes: raw.length,
      parseOk: true,
      entities: Object.keys(d.entities ?? {}).length,
      scores: Object.keys(d.scores ?? {}).length,
      nodes: Object.keys(d.nodes ?? {}).length,
    };
  } catch {
    return { path: fp, bytes: raw.length, parseOk: false, entities: 0, scores: 0 };
  }
}

const paths = [
  resolve(liteDir, "graph.json"),
  resolve(liteDir, "graph.snapshot.json"),
  resolve(liteDir, "graph.json.bak"),
  resolve(liteDir, "graph.json.tmp"),
];

const archDir = resolve(liteDir, "archives");
if (existsSync(archDir)) {
  for (const name of readdirSync(archDir)) {
    if (name.endsWith(".json")) paths.push(resolve(archDir, name));
  }
}

console.log("Lite graph recovery scan:", liteDir);
const results = paths.map(scanFile).filter(Boolean);
results.sort((a, b) => b.entities - a.entities);
for (const r of results) {
  console.log(
    `${r.parseOk ? "OK" : "CORRUPT"} | ${r.entities} entities | ${r.scores} scores | ${(r.bytes / 1024).toFixed(0)} KB | ${r.path}`
  );
}

const best = results.find((r) => r.parseOk && r.entities > 0);
if (best) {
  console.log(`\nBest recoverable: ${best.entities} entities in ${best.path}`);
  console.log("To use it: copy that file to graph.snapshot.json then npm run force status");
} else {
  console.log("\nNo valid graph with entities found. Re-run npm run lite.");
}

/**
 * One-time recovery for static docs missed by a promotion that predates the
 * recursive documentation sync. Replaces only values from a specified prior
 * canonical manifest with values in the current canonical manifest.
 *
 * Usage:
 *   node scripts/reconcile-static-addresses.mjs contracts/deployments/archive/base-8453.<timestamp>.json
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const previousPath = process.argv[2];
if (!previousPath) throw new Error("Pass the archived pre-promotion manifest path.");
const previous = JSON.parse(await readFile(previousPath, "utf8"));
const current = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453.json"), "utf8"));

const namedFiles = [
  "README.md", "BOOTSTRAP.md", "MASTERSKILL.md", "SPEEDPATH.md",
  "launch-skills/launch-skills.md", "launch-skills/treasury-dashboard.html",
  "docs/X402_CLOUD.md", "agents/x402-cloud/README.md", "site/index.html",
  "agents/mcp/skills/azzle/plugins/azzle.md",
];
const documentationExtensions = new Set([".md", ".html", ".txt", ".yaml", ".yml"]);

async function documentationFiles(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await documentationFiles(file));
    else if (documentationExtensions.has(extname(file).toLowerCase())) output.push(file);
  }
  return output;
}

const files = new Set(namedFiles.map((file) => join(root, file)));
for (const directory of ["docs", "site/docs"]) {
  for (const file of await documentationFiles(join(root, directory))) files.add(file);
}

let updated = 0;
for (const file of files) {
  if (!existsSync(file)) continue;
  const before = await readFile(file, "utf8");
  let after = before;
  for (const [key, oldAddress] of Object.entries(previous)) {
    const newAddress = current[key];
    if (typeof oldAddress === "string" && typeof newAddress === "string" && oldAddress !== newAddress) {
      after = after.split(oldAddress).join(newAddress);
    }
  }
  if (after !== before) {
    await writeFile(file, after);
    updated++;
  }
}
console.log(`[manifest] reconciled ${updated} static documentation surfaces from ${previousPath}`);

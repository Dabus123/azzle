/**
 * Sync shared sidebar nav into all site/docs HTML pages.
 * Run: node scripts/sync-docs-nav.mjs
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const docsDir = join(root, "site", "docs");
const fragment = await readFile(join(docsDir, "_sidebar-nav.fragment.html"), "utf8");
const navRe = /(<nav class="docs-sidebar-nav"[^>]*>)[\s\S]*?(<\/nav>)/;

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) out.push(...(await walk(path)));
    else if (name.endsWith(".html") && !name.startsWith("_")) out.push(path);
  }
  return out;
}

for (const path of await walk(docsDir)) {
  let html = await readFile(path, "utf8");
  if (!navRe.test(html)) {
    console.warn(`[sync-docs-nav] skip (no nav): ${path}`);
    continue;
  }
  html = html.replace(navRe, `$1\n${fragment}    $2`);
  await writeFile(path, html, "utf8");
  console.log(`[sync-docs-nav] updated ${path}`);
}

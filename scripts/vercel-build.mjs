/**
 * Vercel build — wallet bundle + static site into public/
 * Stages in .vercel-static first, then swaps in (avoids Vercel reading public/ mid-build).
 */
import * as esbuild from "esbuild";
import { access, cp, mkdir, rename, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const site = join(root, "site");
const out = join(root, "public");
const stage = join(root, ".vercel-static");

const STATIC = [
  "index.html",
  "post.html",
  "pricing.html",
  "market.html",
  "union.html",
  "my-tasks.html",
  "my-work.html",
  "wallet.html",
  "role-dashboard.css",
  "role-dashboard.js",
  "home-parallax.js",
  "infoboard.js",
  "home-quicknav.js",
  "hire-demo.js",
  "site-theme.css",
  "post-checkout.js",
  "market.js",
  "union.js",
  "my-tasks.js",
  "my-work.js",
  "wallet-page.js",
  "aeon.png",
  "bankr.png",
  "xmtp.png",
  "azzletype.png",
  "azzlelogo.png",
  "baselogo.png",
  "GitHub_Invertocat_White.png",
  "npm_logo.png",
  "favicon.ico",
  "og.png",
  "icon.svg",
  "wordmark.svg",
  "docs.css",
  "llms.txt",
  "openapi.yaml",
  "sitemap.xml",
  "robots.txt",
  "docs-shell.js",
  "theme-init.js",
  "theme-toggle.js",
];

async function copyDirRecursive(srcDir, destDir) {
  await mkdir(destDir, { recursive: true });
  for (const name of await readdir(srcDir)) {
    const src = join(srcDir, name);
    const dest = join(destDir, name);
    if ((await stat(src)).isDirectory()) {
      await copyDirRecursive(src, dest);
    } else {
      await cp(src, dest);
    }
  }
}

async function requireFile(name) {
  const src = join(site, name);
  try {
    await access(src, constants.R_OK);
  } catch {
    throw new Error(`[vercel-build] Missing required file: ${name} (not in repo checkout?)`);
  }
  return src;
}

async function injectThemeScripts(dir) {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if ((await stat(path)).isDirectory()) {
      await injectThemeScripts(path);
      continue;
    }
    if (!name.endsWith(".html")) continue;
    let html = await readFile(path, "utf8");
    if (!html.includes('src="/theme-init.js"')) {
      html = html.replace("</head>", '  <script src="/theme-init.js"></script>\n</head>');
    }
    if (!html.includes('src="/theme-toggle.js"') && !html.includes('src="theme-toggle.js"')) {
      html = html.replace("</body>", '  <script src="/theme-toggle.js"></script>\n</body>');
    }
    await writeFile(path, html, "utf8");
  }
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

await import("./sync-manifest-surfaces.mjs");
await import("./sync-site-contract-addresses.mjs");
await import("./sync-docs-nav.mjs");
await import("./verify-v2-site-config.mjs");
await import("./verify-v2-docs.mjs");

for (const name of STATIC) {
  const src = await requireFile(name);
  await cp(src, join(stage, name));
}

const docsDir = join(site, "docs");
try {
  await access(docsDir, constants.R_OK);
  await copyDirRecursive(docsDir, join(stage, "docs"));
  console.log("[vercel-build] docs/ copied");
} catch {
  console.warn("[vercel-build] WARN: site/docs/ missing — developer docs not staged");
}

await esbuild.build({
  entryPoints: [join(root, "src", "wallet-entry.jsx")],
  bundle: true,
  format: "esm",
  outfile: join(stage, "role-wallet.bundle.js"),
  jsx: "automatic",
  target: ["es2022", "chrome109", "firefox109", "safari16"],
  logLevel: "warning",
});

await injectThemeScripts(stage);

await esbuild.build({
  entryPoints: [join(root, "src", "wallet-qr.mjs")],
  bundle: true,
  format: "iife",
  outfile: join(stage, "wallet-qr.js"),
  target: ["es2022", "chrome109", "firefox109", "safari16"],
  logLevel: "warning",
});

const privyAppId = process.env.PRIVY_APP_ID ?? "";
const privyClientId = process.env.PRIVY_CLIENT_ID ?? "";
if (privyAppId) {
  await writeFile(
    join(stage, "privy-config.json"),
    JSON.stringify({ privyAppId, privyClientId }, null, 2),
    "utf8"
  );
  console.log("[vercel-build] privy-config.json written");
} else {
  console.warn("[vercel-build] WARN: PRIVY_APP_ID unset — Sign in will stay disabled");
}

await rm(out, { recursive: true, force: true });
await rename(stage, out);

console.log("[vercel-build] public/ ready (" + STATIC.length + " static files + wallet bundles)");

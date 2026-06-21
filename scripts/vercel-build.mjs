/**
 * Vercel build — wallet bundle + static site into public/
 * Stages in .vercel-static first, then swaps in (avoids Vercel reading public/ mid-build).
 */
import * as esbuild from "esbuild";
import { access, cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = join(root, "public");
const stage = join(root, ".vercel-static");

const STATIC = [
  "index.html",
  "post.html",
  "pricing.html",
  "market.html",
  "my-tasks.html",
  "wallet.html",
  "role-dashboard.css",
  "role-dashboard.js",
  "site-theme.css",
  "post-checkout.js",
  "market.js",
  "my-tasks.js",
  "wallet-page.js",
  "azzletype.png",
  "azzlelogo.png",
  "baselogo.png",
  "stack_logos.png",
  "npm_logo.png",
  "favicon.ico",
  "og.png",
  "icon.svg",
  "wordmark.svg",
];

async function requireFile(name) {
  const src = join(root, name);
  try {
    await access(src, constants.R_OK);
  } catch {
    throw new Error(`[vercel-build] Missing required file: ${name} (not in repo checkout?)`);
  }
  return src;
}

await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

for (const name of STATIC) {
  const src = await requireFile(name);
  await cp(src, join(stage, name));
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

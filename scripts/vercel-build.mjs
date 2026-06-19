/**
 * Vercel build — wallet bundle + static site into public/
 */
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const out = join(root, "public");

const STATIC = [
  "index.html",
  "post.html",
  "pricing.html",
  "my-tasks.html",
  "wallet.html",
  "role-dashboard.css",
  "role-dashboard.js",
  "site-theme.css",
  "post-checkout.js",
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

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const name of STATIC) {
  await cp(join(root, name), join(out, name));
}

await esbuild.build({
  entryPoints: [join(root, "src", "wallet-entry.jsx")],
  bundle: true,
  format: "esm",
  outfile: join(out, "role-wallet.bundle.js"),
  jsx: "automatic",
  target: ["es2022", "chrome109", "firefox109", "safari16"],
  logLevel: "info",
});

console.log("[vercel-build] public/ ready (" + STATIC.length + " static files + wallet bundle)");

/**
 * Bundle Privy wallet UI for static index.html.
 */
import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

await esbuild.build({
  entryPoints: [join(root, "src", "wallet-entry.jsx")],
  bundle: true,
  format: "esm",
  outfile: join(root, "role-wallet.bundle.js"),
  jsx: "automatic",
  target: ["es2022", "chrome109", "firefox109", "safari16"],
  logLevel: "info",
});

console.log("[build-wallet] role-wallet.bundle.js");

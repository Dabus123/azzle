process.env.AZZLE_FORCE_LITE = "1";

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "dist", "cli.js");

function run(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, AZZLE_FORCE_LITE: "1" },
    });
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

console.log("[lite] AZZLE FORCE — no Docker required\n");
console.log("[lite] Close graph.json in your editor while agents run (Windows locks renames).\n");
console.log("[lite] Persistence: graph.snapshot.json (always) + graph.json\n");

const wave = process.argv[2] ?? "1";
if (wave === "all") {
  console.log("[lite] Starting waves 1–3 + 6 (discovery + outreach + second brain)\n");
}
// createContext() runs migrate on startup — single process avoids double-init
const waveCode = await run(["wave", wave]);
process.exit(waveCode);

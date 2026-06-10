import type { AeonSetupOptions } from "./types.js";

export function parseAeonSetupArgs(argv: string[]): AeonSetupOptions {
  let role: string | undefined;
  let dir: string | undefined;
  let dryRun = false;
  let aeonOverlay = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--role" && argv[i + 1]) {
      role = argv[++i];
    } else if (arg === "--dir" && argv[i + 1]) {
      dir = argv[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--aeon") {
      aeonOverlay = true;
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else if (!dir) {
      dir = arg;
    }
  }

  return { role, dir, dryRun, aeonOverlay };
}

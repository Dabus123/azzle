import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function hasDocker(): boolean {
  const r = spawnSync("docker", ["--version"], { encoding: "utf8", shell: true });
  return r.status === 0;
}

if (!hasDocker()) {
  console.error(`
Docker is not installed or not on your PATH.

  Option A — Install Docker Desktop for Windows:
    https://docs.docker.com/desktop/setup/install/windows-install/
    Then: npm run up

  Option B — Run without Docker (lite mode, file-backed graph):
    npm run lite
    (or set AZZLE_FORCE_LITE=true in .env and run npm run migrate && npm run force wave 1)
`);
  process.exit(1);
}

const up = spawnSync("docker", ["compose", "up", "-d"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

process.exit(up.status ?? 1);

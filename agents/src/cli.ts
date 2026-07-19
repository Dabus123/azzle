#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AEON_UPSTREAM, handleAeonSetup, PACKAGE_VERSION } from "./aeon-setup/index.js";
import { BASE_MAINNET_MANIFEST } from "./sdk/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const GITHUB_REPO = "https://github.com/Dabus123/azzle.git";

const HELP = `azzle — AZZLE protocol agent installer (v${PACKAGE_VERSION})

Usage:
  npx @azzle/agents@latest init [dir]              Scaffold a minimal agent project
  npx @azzle/agents@latest install [dir]           Alias for init
  npx @azzle/agents@latest aeon-setup [options]    Interactive role wizard (Base mainnet)
  npx @azzle/agents@latest aeon-setup --aeon [dir] Add AZZLE skills to an Aeon fork
  npx @azzle/agents@latest add                     Add @azzle/agents to the current project
  npx @azzle/agents@latest addresses               Print Base mainnet contract addresses
  npx @azzle/agents@latest version                 Print package version

aeon-setup options:
  --role worker|poster|verifier|arbitrator   Skip interactive role menu
  --dir <path>                               Output directory (default: azzle-<role>)
  --dry-run                                  Preview files without writing
  --aeon                                     Legacy Aeon fork overlay (requires aeon.yml)

Examples:
  npx @azzle/agents@latest aeon-setup
  npx @azzle/agents@latest aeon-setup --role worker --dir my-worker
  npx @azzle/agents@latest aeon-setup --role poster --dry-run
  git clone https://github.com/<you>/aeon && cd aeon && npx @azzle/agents@latest aeon-setup --aeon

Aeon framework: ${AEON_UPSTREAM}
Docs: https://github.com/Dabus123/azzle/blob/main/AGENTS.md
`;

function run(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; allowFailure?: boolean }
): boolean {
  const result = spawnSync(cmd, args, {
    cwd: opts?.cwd,
    stdio: "inherit",
    shell: false,
  });
  const ok = result.status === 0;
  if (!ok && !opts?.allowFailure) {
    process.exit(result.status ?? 1);
  }
  return ok;
}

function runNpm(args: string[], cwd: string, opts?: { allowFailure?: boolean }): boolean {
  const result = spawnSync("npm", args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const ok = result.status === 0;
  if (!ok && !opts?.allowFailure) {
    process.exit(result.status ?? 1);
  }
  return ok;
}

function installAgentsPackage(cwd: string, usePackageJson = false): void {
  if (usePackageJson) {
    console.log("Installing dependencies ...");
    if (runNpm(["install"], cwd, { allowFailure: true })) {
      return;
    }
  } else {
    console.log("Installing @azzle/agents@latest ...");
    if (runNpm(["install", "@azzle/agents@latest"], cwd, { allowFailure: true })) {
      return;
    }
  }

  installFromGitHubSource(cwd);
}

function installFromGitHubSource(cwd: string): void {
  const tmpBase = mkdtempSync(join(tmpdir(), "azzle-install-"));
  const cloneDir = join(tmpBase, "repo");

  console.log("npm registry unavailable; cloning agents package from GitHub ...");

  if (
    !run(
      "git",
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", GITHUB_REPO, cloneDir],
      { allowFailure: true }
    )
  ) {
    rmSync(tmpBase, { recursive: true, force: true });
    process.exit(1);
  }

  if (!run("git", ["sparse-checkout", "set", "agents"], { cwd: cloneDir, allowFailure: true })) {
    rmSync(tmpBase, { recursive: true, force: true });
    process.exit(1);
  }

  const agentsDir = join(cloneDir, "agents");
  runNpm(["install"], agentsDir);
  runNpm(["run", "build"], agentsDir);
  runNpm(["install", `file:${agentsDir}`], cwd);

  rmSync(tmpBase, { recursive: true, force: true });
}

function scaffoldProject(targetDir: string): void {
  const absDir = resolve(process.cwd(), targetDir);

  if (existsSync(absDir) && existsSync(join(absDir, "package.json"))) {
    console.error(`Error: ${absDir} already has a package.json. Use "add" in that directory instead.`);
    process.exit(1);
  }

  mkdirSync(absDir, { recursive: true });

  const projectName = targetDir === "." ? "azzle-agent" : targetDir;

  writeFileSync(
    join(absDir, "package.json"),
    JSON.stringify(
      {
        name: projectName,
        version: "0.1.0",
        private: true,
        type: "module",
        description: "AZZLE protocol agent on Base",
        scripts: {
          start: "node agent.mjs",
          "list-open": "node agent.mjs list-open",
        },
        dependencies: {
          "@azzle/agents": `^${PACKAGE_VERSION}`,
        },
        engines: {
          node: ">=22",
        },
      },
      null,
      2
    ) + "\n"
  );

  writeFileSync(join(absDir, ".gitignore"), ["node_modules/", ".env", "dist/", ""].join("\n"));

  writeFileSync(
    join(absDir, ".env.example"),
    [
      "# Base mainnet RPC",
      "AZZLE_RPC_URL=https://mainnet.base.org",
      "",
      "# Use a dedicated Base RPC provider in production",
      "# AZZLE_RPC_URL=https://your-base-rpc-provider.example",
      "",
      "# Wallet private key (never commit .env)",
      "# PRIVATE_KEY=0x...",
      "",
    ].join("\n")
  );

  copyFileSync(
    join(PACKAGE_ROOT, "deployments", "base-8453.json"),
    join(absDir, "base-8453.json")
  );

  writeFileSync(join(absDir, "agent.mjs"), AGENT_TEMPLATE);

  console.log(`Scaffolding AZZLE agent in ${absDir} ...`);
  installAgentsPackage(absDir, true);

  console.log(`
Done. Next steps:
  cd ${targetDir === "." ? "" : targetDir}${targetDir === "." ? "" : "\n  "}cp .env.example .env   # add PRIVATE_KEY when ready
  npm run list-open        # discover POSTED tasks via Base RPC

Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md
`);
}

function addToProject(): void {
  const cwd = process.cwd();
  if (!existsSync(join(cwd, "package.json"))) {
    console.error("Error: no package.json in current directory. Run: npx @azzle/agents init [dir]");
    process.exit(1);
  }

  installAgentsPackage(cwd);

  if (!existsSync(join(cwd, "base-8453.json"))) {
    copyFileSync(
      join(PACKAGE_ROOT, "deployments", "base-8453.json"),
      join(cwd, "base-8453.json")
    );
    console.log("Wrote base-8453.json (canonical Base mainnet addresses).");
  }

  console.log(`
Installed @azzle/agents.

  import { AzzleClient, BaseRpcIndexer } from "@azzle/agents";
  import { BASE_MAINNET_MANIFEST } from "@azzle/agents/manifest";

Docs: https://github.com/Dabus123/azzle/blob/main/AGENTS.md
`);
}

function printAddresses(): void {
  const m = BASE_MAINNET_MANIFEST;
  console.log(`AZZLE Base mainnet (chainId ${m.chainId})`);
  console.log("");
  for (const [key, value] of Object.entries(m)) {
    console.log(`${key.padEnd(20)} ${value}`);
  }
}

const AGENT_TEMPLATE = `import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BaseRpcIndexer } from "@azzle/agents";

const __dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dir, "base-8453.json"), "utf8"));

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

async function listOpen() {
  const indexer = new BaseRpcIndexer({ rpcUrl });
  const tasks = await indexer.getOpenTasks();
  console.log(JSON.stringify({ count: tasks.length, tasks }, null, 2));
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  if (cmd === "list-open") {
    await listOpen();
    return;
  }

  console.log("AZZLE agent scaffold");
  console.log("  RPC:", rpcUrl);
  console.log("  TaskRegistry:", manifest.TaskRegistry);
  console.log("");
  console.log("Commands:");
  console.log("  node agent.mjs list-open   # POSTED tasks from Base RPC");
  console.log("");
  console.log("Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

async function main(): Promise<void> {
  const [command = "help", ...rest] = process.argv.slice(2);

  switch (command) {
    case "init":
    case "install":
      scaffoldProject(rest[0] ?? "azzle-agent");
      break;
    case "add":
      addToProject();
      break;
    case "aeon-setup":
    case "aeon":
      await handleAeonSetup(rest);
      break;
    case "addresses":
      printAddresses();
      break;
    case "version":
    case "-v":
    case "--version":
      console.log(PACKAGE_VERSION);
      break;
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      process.stdout.write(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

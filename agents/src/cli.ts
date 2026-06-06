#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
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
import { BASE_MAINNET_MANIFEST } from "./sdk/manifest.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const PACKAGE_VERSION = readPackageVersion();
const GITHUB_REPO = "https://github.com/Dabus123/azzle.git";
const AEON_UPSTREAM = "https://github.com/aaronjmars/aeon";
const SCAFFOLD_AEON = join(PACKAGE_ROOT, "scaffolding", "aeon");

const HELP = `azzle — AZZLE protocol agent installer (v${PACKAGE_VERSION})

Usage:
  npx @azzle/agents@latest init [dir]       Scaffold a minimal agent project
  npx @azzle/agents@latest install [dir]    Alias for init
  npx @azzle/agents@latest aeon-setup [dir] Add AZZLE skills to an Aeon fork
  npx @azzle/agents@latest add              Add @azzle/agents to the current project
  npx @azzle/agents@latest addresses        Print Base mainnet contract addresses
  npx @azzle/agents@latest version          Print package version

Examples:
  npx @azzle/agents@latest init my-agent
  git clone https://github.com/<you>/aeon && cd aeon && npx @azzle/agents@latest aeon-setup
  npx @azzle/agents@latest add

Aeon framework: ${AEON_UPSTREAM}
Docs: https://github.com/Dabus123/azzle/blob/main/AGENTS.md
`;

function readPackageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")
  ) as { version?: string };
  return pkg.version ?? "0.0.0";
}

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

/** Clone agents/ from GitHub when the package is not on the npm registry yet. */
function installFromGitHubSource(cwd: string): void {
  const tmpBase = mkdtempSync(join(tmpdir(), "azzle-install-"));
  const cloneDir = join(tmpBase, "repo");

  console.log("npm registry unavailable; cloning agents package from GitHub ...");

  if (
    !run("git", [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      GITHUB_REPO,
      cloneDir,
    ], { allowFailure: true })
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

  writeFileSync(
    join(absDir, ".gitignore"),
    ["node_modules/", ".env", "dist/", ""].join("\n")
  );

  writeFileSync(
    join(absDir, ".env.example"),
    [
      "# Base mainnet RPC",
      "AZZLE_RPC_URL=https://mainnet.base.org",
      "",
      "# Optional: override subgraph endpoint",
      "AZZLE_SUBGRAPH_URL=https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.1",
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
  npm run list-open        # discover POSTED tasks via subgraph

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

  import { AzzleClient, SubgraphIndexer } from "@azzle/agents";
  import { BASE_MAINNET_MANIFEST } from "@azzle/agents/manifest";

Docs: https://github.com/Dabus123/azzle/blob/main/AGENTS.md
`);
}

function mergeAeonSkills(aeonYmlPath: string): void {
  const snippetPath = join(SCAFFOLD_AEON, "aeon-skills.snippet.yml");
  const snippet = readFileSync(snippetPath, "utf8");
  let yml = readFileSync(aeonYmlPath, "utf8");

  if (yml.includes("azzle-market:")) {
    console.log("aeon.yml already has azzle-market — skipping skill merge.");
    return;
  }

  const skillsIdx = yml.indexOf("skills:");
  if (skillsIdx === -1) {
    yml += `\nskills:${snippet}`;
  } else {
    yml = yml.trimEnd() + snippet;
  }

  writeFileSync(aeonYmlPath, yml.endsWith("\n") ? yml : yml + "\n");
  console.log("Merged azzle-market + azzle-worker into aeon.yml (disabled by default).");
}

function aeonSetup(targetDir?: string): void {
  const cwd = resolve(process.cwd(), targetDir ?? ".");
  const aeonYml = join(cwd, "aeon.yml");

  if (!existsSync(aeonYml)) {
    console.error(`Not an Aeon repo (missing aeon.yml in ${cwd}).`);
    console.error(`Fork ${AEON_UPSTREAM}, clone your fork, then run aeon-setup again.`);
    process.exit(1);
  }

  if (!existsSync(SCAFFOLD_AEON)) {
    console.error("AEON scaffolding pack missing from @azzle/agents install.");
    process.exit(1);
  }

  console.log(`Applying AZZLE overlay to Aeon at ${cwd} ...`);

  cpSync(join(SCAFFOLD_AEON, "skills", "azzle-market"), join(cwd, "skills", "azzle-market"), {
    recursive: true,
  });
  cpSync(join(SCAFFOLD_AEON, "skills", "azzle-worker"), join(cwd, "skills", "azzle-worker"), {
    recursive: true,
  });

  mkdirSync(join(cwd, "scripts", "azzle"), { recursive: true });
  copyFileSync(
    join(SCAFFOLD_AEON, "scripts", "azzle", "subgraph.sh"),
    join(cwd, "scripts", "azzle", "subgraph.sh")
  );

  mkdirSync(join(cwd, "memory", "topics"), { recursive: true });
  copyFileSync(
    join(SCAFFOLD_AEON, "memory", "topics", "azzle-protocol.md"),
    join(cwd, "memory", "topics", "azzle-protocol.md")
  );

  mkdirSync(join(cwd, "azzle"), { recursive: true });
  copyFileSync(join(SCAFFOLD_AEON, "azzle", "list-open.mjs"), join(cwd, "azzle", "list-open.mjs"));
  copyFileSync(
    join(PACKAGE_ROOT, "deployments", "base-8453.json"),
    join(cwd, "azzle", "base-8453.json")
  );

  const pkgPath = join(cwd, "azzle", "package.json");
  const pkg = JSON.parse(readFileSync(join(SCAFFOLD_AEON, "azzle", "package.json"), "utf8")) as {
    name: string;
    private: boolean;
    type: string;
    description: string;
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    engines: Record<string, string>;
  };
  pkg.dependencies["@azzle/agents"] = `^${PACKAGE_VERSION}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  copyFileSync(join(SCAFFOLD_AEON, "README.md"), join(cwd, "azzle", "README.md"));

  mergeAeonSkills(aeonYml);

  console.log("Installing @azzle/agents in azzle/ ...");
  installAgentsPackage(join(cwd, "azzle"), true);

  console.log(`
AZZLE + Aeon setup complete.

  ./scripts/azzle/subgraph.sh open-tasks   # read-only task discovery
  cd azzle && npm run list-open            # SDK subgraph query

Enable skills in aeon.yml (or dashboard):
  azzle-market  — daily POSTED-task digest
  azzle-worker  — on-demand claim playbook (Bankr for on-chain)

See azzle/README.md and memory/topics/azzle-protocol.md
Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md
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

const AGENT_TEMPLATE = `import { SubgraphIndexer } from "@azzle/agents";
import manifest from "./base-8453.json" with { type: "json" };

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";
const subgraphUrl = process.env.AZZLE_SUBGRAPH_URL;

async function listOpen() {
  const indexer = new SubgraphIndexer({ subgraphUrl });
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
  console.log("  node agent.mjs list-open   # POSTED tasks from subgraph");
  console.log("");
  console.log("Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
`;

const [command = "help", arg] = process.argv.slice(2);

switch (command) {
  case "init":
  case "install":
    scaffoldProject(arg ?? "azzle-agent");
    break;
  case "add":
    addToProject();
    break;
  case "aeon-setup":
  case "aeon":
    aeonSetup(arg);
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

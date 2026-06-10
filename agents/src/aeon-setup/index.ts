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
import * as clack from "@clack/prompts";
import { parseAeonSetupArgs } from "./parse-args.js";
import { promptAgentRole, promptOutputDir } from "./prompts.js";
import { scaffoldRoleProject } from "./scaffold.js";
import { isAgentRole } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");
const GITHUB_REPO = "https://github.com/Dabus123/azzle.git";
const AEON_UPSTREAM = "https://github.com/aaronjmars/aeon";
const SCAFFOLD_AEON = join(PACKAGE_ROOT, "scaffolding", "aeon");

function readPackageVersion(): string {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as {
    version?: string;
  };
  return pkg.version ?? "0.0.0";
}

const PACKAGE_VERSION = readPackageVersion();

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

function installAgentsPackage(cwd: string, usePackageJson = false): void {
  if (usePackageJson) {
    console.log("Installing dependencies ...");
    if (runNpm(["install"], cwd, { allowFailure: true })) {
      return;
    }
  } else {
    console.log("Installing @azzle/agents@latest ...");
    if (runNpm(["install", `@azzle/agents@^${PACKAGE_VERSION}`], cwd, { allowFailure: true })) {
      return;
    }
  }
  installFromGitHubSource(cwd);
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

function aeonOverlaySetup(targetDir?: string): void {
  const cwd = resolve(process.cwd(), targetDir ?? ".");
  const aeonYml = join(cwd, "aeon.yml");

  if (!existsSync(aeonYml)) {
    console.error(`Not an Aeon repo (missing aeon.yml in ${cwd}).`);
    console.error(`Fork ${AEON_UPSTREAM}, clone your fork, then run aeon-setup --aeon again.`);
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
    dependencies: Record<string, string>;
  };
  pkg.dependencies["@azzle/agents"] = `^${PACKAGE_VERSION}`;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  copyFileSync(join(SCAFFOLD_AEON, "README.md"), join(cwd, "azzle", "README.md"));

  mergeAeonSkills(aeonYml);

  console.log("Installing @azzle/agents in azzle/ ...");
  installAgentsPackage(join(cwd, "azzle"), true);

  console.log(`
AZZLE + Aeon overlay complete.

  ./scripts/azzle/subgraph.sh open-tasks
  cd azzle && npm run list-open

Enable skills in aeon.yml: azzle-market, azzle-worker
Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md
`);
}

export async function handleAeonSetup(argv: string[]): Promise<void> {
  const opts = parseAeonSetupArgs(argv);

  if (opts.aeonOverlay) {
    aeonOverlaySetup(opts.dir);
    return;
  }

  let role = opts.role;
  if (!role) {
    if (!process.stdin.isTTY) {
      console.error("Pass --role worker|poster|verifier|arbitrator (no TTY for interactive menu).");
      process.exit(1);
    }
    role = await promptAgentRole();
  }

  if (!isAgentRole(role)) {
    clack.log.error(`Unknown role "${role}". Use: worker, poster, verifier, arbitrator`);
    process.exit(1);
  }

  const defaultDir = `azzle-${role}`;
  let targetDir = opts.dir;
  if (!targetDir && !opts.dryRun && process.stdin.isTTY) {
    targetDir = await promptOutputDir(defaultDir);
  } else {
    targetDir = targetDir ?? defaultDir;
  }

  scaffoldRoleProject(role, targetDir, opts.dryRun, PACKAGE_VERSION);

  if (!opts.dryRun) {
    const absDir = resolve(process.cwd(), targetDir);
    installAgentsPackage(absDir, true);
  }
}

export { AEON_UPSTREAM, PACKAGE_VERSION };

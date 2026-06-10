import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import type { AgentRole } from "./types.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCAFFOLD_ROLES = join(PACKAGE_ROOT, "scaffolding", "roles");

export interface ScaffoldPlan {
  role: AgentRole;
  absDir: string;
  files: string[];
}

function collectFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? join(prefix, name) : name;
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, rel));
    } else {
      out.push(rel.replace(/\\/g, "/"));
    }
  }
  return out;
}

export function planRoleScaffold(role: AgentRole, targetDir: string): ScaffoldPlan {
  const absDir = resolve(process.cwd(), targetDir);
  const roleDir = join(SCAFFOLD_ROLES, role);
  const sharedDir = join(SCAFFOLD_ROLES, "shared");

  if (!existsSync(roleDir)) {
    throw new Error(`Role scaffold missing: ${roleDir}`);
  }

  const files: string[] = [];
  if (existsSync(sharedDir)) {
    files.push(...collectFiles(sharedDir));
  }
  files.push(...collectFiles(roleDir));
  files.push("base-8453.json");

  return { role, absDir, files: [...new Set(files)].sort() };
}

export function printDryRun(plan: ScaffoldPlan): void {
  console.log(`\n[dry-run] Would scaffold ${plan.role} agent → ${plan.absDir}\n`);
  for (const file of plan.files) {
    console.log(`  write  ${join(plan.absDir, file)}`);
  }
  console.log("\n[dry-run] Would run: npm install\n");
}

export function scaffoldRoleProject(
  role: AgentRole,
  targetDir: string,
  dryRun: boolean,
  packageVersion: string
): void {
  const plan = planRoleScaffold(role, targetDir);

  if (dryRun) {
    printDryRun(plan);
    return;
  }

  if (existsSync(plan.absDir) && existsSync(join(plan.absDir, "package.json"))) {
    throw new Error(`${plan.absDir} already has package.json — pick another --dir`);
  }

  mkdirSync(plan.absDir, { recursive: true });

  const roleDir = join(SCAFFOLD_ROLES, role);
  const sharedDir = join(SCAFFOLD_ROLES, "shared");

  if (existsSync(sharedDir)) {
    cpSync(sharedDir, plan.absDir, { recursive: true });
  }
  cpSync(roleDir, plan.absDir, { recursive: true });

  const pkgPath = join(plan.absDir, "package.json");
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      name?: string;
      dependencies?: Record<string, string>;
    };
    pkg.name = basename(plan.absDir);
    if (pkg.dependencies?.["@azzle/agents"]) {
      pkg.dependencies["@azzle/agents"] = `^${packageVersion}`;
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  }

  copyFileSync(
    join(PACKAGE_ROOT, "deployments", "base-8453.json"),
    join(plan.absDir, "base-8453.json")
  );

  clack.log.success(`Scaffolded ${role} agent in ${plan.absDir}`);
  const relDir = relative(process.cwd(), plan.absDir) || ".";
  console.log(`
Next steps:
  cd ${relDir}
  cp .env.example .env    # add PRIVATE_KEY
  npm install
  npm run preflight       # wallet + deposit checks
  npm start

Onboarding: https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md
`);
}

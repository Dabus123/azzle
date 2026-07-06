import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { GitHubClient } from "../tools/github.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dir, "../..");

export interface MiniappDeployConfig {
  sourceDir: string;
  pagesPrefix: string;
  repo: string;
  branch: string;
  baseUrl?: string;
}

export interface DeployResult {
  baseUrl: string;
  miniappUrl: string;
  filesDeployed: number;
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkFiles(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Patch manifest + HTML with live GitHub Pages URLs before deploy. */
export function patchMiniappUrls(html: string, manifest: string, miniappUrl: string): {
  html: string;
  manifest: string;
} {
  const base = miniappUrl.replace(/\/?$/, "/");
  const legacyPatterns = [
    /https:\/\/dabus123\.github\.io\/azzle\/human-terminal\/?/gi,
    /https:\/\/azzleforce\.github\.io\/human-terminal\/?/gi,
    /https:\/\/azzleforce\.github\.io\/azzle-farcaster\/?/gi,
    /https:\/\/azzleforce\.github\.io\/azzleforce\/?/gi,
    /https:\/\/azzleforce\.github\.io\/(?!azzle)/gi,
  ];

  let patchedHtml = html;
  for (const re of legacyPatterns) {
    patchedHtml = patchedHtml.replace(re, base);
  }
  patchedHtml = patchedHtml.replace(
    /"url":"https?:\/\/[^"]+\/human-terminal\/"/g,
    `"url":"${base}"`
  );

  let patchedManifest = manifest;
  for (const re of legacyPatterns) {
    patchedManifest = patchedManifest.replace(re, base);
  }
  try {
    const json = JSON.parse(patchedManifest) as {
      miniapp?: Record<string, string>;
    };
    if (json.miniapp) {
      json.miniapp.homeUrl = base;
      patchedManifest = JSON.stringify(json, null, 2) + "\n";
    }
  } catch {
    /* keep string-replaced manifest */
  }

  return { html: patchedHtml, manifest: patchedManifest };
}

export function defaultPagesRepo(login = "azzleforce"): string {
  return `${login}/${login}.github.io`;
}

export async function resolveMiniappDeployConfig(github: GitHubClient): Promise<MiniappDeployConfig> {
  const path = resolve(PACKAGE_ROOT, "config/miniapps.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    humanTerminal: {
      sourceDir: string;
      pagesPrefix: string;
      pagesRepoCandidates?: string[];
    };
  };

  const login = (await github.getAuthenticatedLogin()) ?? "azzleforce";
  const candidates = [
    process.env.GITHUB_PAGES_REPO,
    ...(raw.humanTerminal.pagesRepoCandidates ?? []),
    defaultPagesRepo(login),
  ].filter(Boolean) as string[];

  const repo =
    (process.env.GITHUB_PAGES_REPO?.trim()) ||
    (await github.resolveAccessibleRepo(candidates)) ||
    defaultPagesRepo(login);

  const branch = process.env.GITHUB_PAGES_BRANCH ?? "main";
  const baseUrl =
    process.env.GITHUB_PAGES_BASE_URL?.trim() ||
    github.pagesBaseUrl(repo);

  return {
    sourceDir: raw.humanTerminal.sourceDir,
    pagesPrefix: raw.humanTerminal.pagesPrefix.replace(/\/$/, ""),
    repo,
    branch,
    baseUrl,
  };
}

export async function deployHumanTerminal(
  github: GitHubClient,
  cfg?: MiniappDeployConfig
): Promise<DeployResult> {
  const deployCfg = cfg ?? (await resolveMiniappDeployConfig(github));
  await github.ensureRepo(deployCfg.repo, {
    description: "AZZLE FORCE — Human Terminal Farcaster miniapp + Snaps",
    autoInit: true,
  });
  await github.enablePages(deployCfg.repo, deployCfg.branch);

  const localDir = resolve(PACKAGE_ROOT, deployCfg.sourceDir);
  const pagesBase = deployCfg.baseUrl?.replace(/\/?$/, "/") ?? github.pagesBaseUrl(deployCfg.repo);
  const prefix = deployCfg.pagesPrefix.replace(/^\//, "").replace(/\/$/, "");
  const miniappUrl = prefix ? `${pagesBase}${prefix}/` : pagesBase;

  const files = walkFiles(localDir);
  let deployed = 0;

  for (const file of files) {
    const rel = relative(localDir, file).replace(/\\/g, "/");
    const destPath = prefix ? `${prefix}/${rel}`.replace(/\/+/g, "/") : rel;
    let content = readFileSync(file, "utf8");

    if (rel === "index.html") {
      const manifestPath = join(localDir, ".well-known", "farcaster.json");
      const manifestRaw = readFileSync(manifestPath, "utf8");
      const patched = patchMiniappUrls(content, manifestRaw, miniappUrl);
      content = patched.html;
    }
    if (rel === ".well-known/farcaster.json") {
      const htmlPath = join(localDir, "index.html");
      const htmlRaw = readFileSync(htmlPath, "utf8");
      const patched = patchMiniappUrls(htmlRaw, content, miniappUrl);
      content = patched.manifest;
    }

    await github.upsertFile(deployCfg.repo, deployCfg.branch, destPath, content);
    deployed++;
  }

  return { baseUrl: pagesBase, miniappUrl, filesDeployed: deployed };
}

export function loadMiniappCastTemplates(): string[] {
  const path = resolve(PACKAGE_ROOT, "config/miniapps.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    humanTerminal?: { castTemplates?: string[] };
  };
  return raw.humanTerminal?.castTemplates ?? [];
}

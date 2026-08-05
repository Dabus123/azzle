import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

let bundledManifest = null;
try {
  bundledManifest = require("../contracts/deployments/base-8453.json");
} catch {
  /* load from disk at runtime */
}

export function loadEnvFile(envPath) {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

export function loadManifest() {
  if (bundledManifest) return bundledManifest;
  const path = join(process.cwd(), "contracts", "deployments", "base-8453.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function baseCfg() {
  const MANIFEST = loadManifest();
  return {
    BANKR_BASE: (process.env.OPENAI_BASE_URL ?? "https://llm.bankr.bot/v1").replace(/\/$/, ""),
    BANKR_KEY: process.env.BANKR_API_KEY ?? process.env.BANKR_KEY ?? "",
    MODEL: process.env.AZZLE_LLM_MODEL ?? "deepseek-v4-flash",
    PRIVY_APP_ID: process.env.PRIVY_APP_ID ?? "",
    PRIVY_CLIENT_ID: process.env.PRIVY_CLIENT_ID ?? "",
    BASE_RPC: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    MANIFEST,
    BILLING_WALLET: process.env.AZZLE_BILLING_WALLET ?? MANIFEST?.governance ?? "",
  };
}

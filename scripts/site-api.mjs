/**
 * Shared HTTP handlers for azzle.org — local site-server + Vercel /api/*.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PLANS,
  getQuota,
  assertCanPost,
  recordPost,
  applyUpgrade,
  createUpgradeQuote,
  previewAzlUpgrade,
  AZL_PAY_DISCOUNT,
} from "./posting-limits.mjs";
import { fetchAzlUsdPrice } from "./azl-price.mjs";
import { getPosterTasks } from "./poster-tasks.mjs";
import { postingStoreBackend } from "./posting-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

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
  const path = resolve(ROOT, "contracts", "deployments", "base-8453.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function cfg() {
  const MANIFEST = loadManifest();
  return {
    BANKR_BASE: (process.env.OPENAI_BASE_URL ?? "https://llm.bankr.bot/v1").replace(/\/$/, ""),
    BANKR_KEY: process.env.BANKR_API_KEY ?? "",
    MODEL: process.env.AZZLE_LLM_MODEL ?? "deepseek-v4-flash",
    PRIVY_APP_ID: process.env.PRIVY_APP_ID ?? "",
    PRIVY_CLIENT_ID: process.env.PRIVY_CLIENT_ID ?? "",
    BASE_RPC: process.env.BASE_RPC_URL ?? "https://mainnet.base.org",
    MANIFEST,
    BILLING_WALLET: process.env.AZZLE_BILLING_WALLET ?? MANIFEST?.feeRecipient ?? "",
  };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(status, body, extraHeaders = {}) {
  return {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extraHeaders },
    json: body,
  };
}

async function proxyRoleChat(body) {
  const { BANKR_KEY, BANKR_BASE, MODEL } = cfg();
  if (!BANKR_KEY) {
    return json(503, { error: "BANKR_API_KEY not configured" });
  }
  const { system, messages } = body;
  if (!system || !Array.isArray(messages)) {
    return json(400, { error: "system and messages required" });
  }

  const payload = {
    model: body.model || MODEL,
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: 400,
    temperature: 0.3,
  };

  const upstream = await fetch(`${BANKR_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BANKR_KEY}`,
      "X-API-Key": BANKR_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return json(upstream.status, {
      error: "Bankr LLM Gateway error",
      detail: text.slice(0, 500),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return json(502, { error: "Invalid JSON from gateway" });
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  return json(200, { text: content, model: payload.model });
}

/**
 * @param {{ method: string, pathname: string, searchParams: URLSearchParams, body?: unknown }} req
 */
export async function handleSiteApi({ method, pathname, searchParams, body = {} }) {
  const {
    BANKR_KEY,
    BANKR_BASE,
    MODEL,
    PRIVY_APP_ID,
    PRIVY_CLIENT_ID,
    BASE_RPC,
    MANIFEST,
    BILLING_WALLET,
  } = cfg();

  if (method === "OPTIONS") {
    return { status: 204, headers: CORS, json: null };
  }

  try {
    if (method === "POST" && pathname === "/api/role-chat") {
      return proxyRoleChat(body);
    }

    if (method === "GET" && pathname === "/api/role-chat/health") {
      return json(200, { ok: Boolean(BANKR_KEY), model: MODEL, gateway: BANKR_BASE });
    }

    if (method === "GET" && pathname === "/api/site-config") {
      return json(200, {
        privyAppId: PRIVY_APP_ID,
        privyClientId: PRIVY_CLIENT_ID,
        chainId: Number(MANIFEST?.chainId ?? 8453),
        chainName: "Base",
        rpcUrl: BASE_RPC,
        contracts: MANIFEST
          ? {
              usdc: MANIFEST.usdc,
              azlToken: MANIFEST.azlToken,
              TaskRegistry: MANIFEST.TaskRegistry,
              AgentDepositVault: MANIFEST.AgentDepositVault,
              TreasuryRouter: MANIFEST.TreasuryRouter,
              EscrowVault: MANIFEST.EscrowVault,
            }
          : null,
        billingWallet: BILLING_WALLET || null,
        postingPlans: Object.values(PLANS),
        azlPayDiscount: AZL_PAY_DISCOUNT,
        postingStore: postingStoreBackend(),
      });
    }

    if (method === "GET" && pathname === "/api/posting/plans") {
      return json(200, {
        plans: Object.values(PLANS),
        billingWallet: BILLING_WALLET || null,
        azlPayDiscount: AZL_PAY_DISCOUNT,
      });
    }

    if (method === "GET" && pathname === "/api/posting/azl-price") {
      try {
        const price = await fetchAzlUsdPrice();
        return json(200, { ...price, discountPercent: AZL_PAY_DISCOUNT * 100 });
      } catch (e) {
        return json(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/quote") {
      const tier = searchParams.get("tier");
      const address = searchParams.get("address");
      const payWith = searchParams.get("payWith") ?? "azl";
      try {
        if (payWith !== "azl") throw new Error("Only payWith=azl is supported for quotes.");
        const quote = await createUpgradeQuote({ address, tier });
        return json(200, quote);
      } catch (e) {
        return json(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/azl-preview") {
      const tier = searchParams.get("tier");
      try {
        const preview = await previewAzlUpgrade(tier);
        return json(200, preview);
      } catch (e) {
        return json(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/quota") {
      const address = searchParams.get("address");
      try {
        const quota = await getQuota(address);
        return json(200, quota);
      } catch (e) {
        return json(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/poster/tasks") {
      const address = searchParams.get("address");
      try {
        const tasks = await getPosterTasks(address);
        return json(200, { tasks });
      } catch (e) {
        return json(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "POST" && pathname === "/api/posting/record") {
      try {
        const quota = await recordPost(body.address, {
          taskId: body.taskId,
          txHash: body.txHash,
        });
        return json(200, quota);
      } catch (e) {
        const status = e.code === "QUOTA_EXCEEDED" ? 429 : 400;
        return json(status, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && pathname === "/api/posting/check") {
      try {
        const quota = await assertCanPost(body.address);
        return json(200, quota);
      } catch (e) {
        return json(429, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && pathname === "/api/posting/upgrade") {
      try {
        if (!BILLING_WALLET) throw new Error("Billing wallet not configured on server.");
        if (!MANIFEST?.usdc) throw new Error("USDC address missing from manifest.");
        const quota = await applyUpgrade({
          address: body.address,
          tier: body.tier,
          txHash: body.txHash,
          billingWallet: BILLING_WALLET,
          usdcAddress: MANIFEST.usdc,
          azlAddress: MANIFEST.azlToken,
          rpcUrl: BASE_RPC,
          payWith: body.payWith ?? "usdc",
          quoteId: body.quoteId,
        });
        return json(200, quota);
      } catch (e) {
        return json(400, { error: e.message ?? String(e) });
      }
    }

    return json(404, { error: "not_found" });
  } catch (err) {
    return json(500, { error: err.message ?? String(err) });
  }
}

/** Send a handleSiteApi result through a Node HTTP response (local dev server). */
export function sendApiResult(res, result) {
  const headers = result.headers ?? { "Content-Type": "application/json" };
  if (result.json == null) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  res.writeHead(result.status, headers);
  res.end(JSON.stringify(result.json));
}

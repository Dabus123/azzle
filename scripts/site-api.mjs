/**
 * Shared HTTP handlers for azzle.org — local site-server + Vercel /api/*.
 * Heavy deps (viem) load only for posting/chain routes.
 */
import { loadEnvFile } from "./manifest.mjs";
import { baseCfg } from "./manifest.mjs";
import { PLANS, AZL_PAY_DISCOUNT } from "./posting-plans.mjs";
import { buildSiteConfigResponse } from "./site-config-handler.mjs";
import { CORS, apiJson } from "./vercel-http.mjs";

export { loadEnvFile, loadManifest } from "./manifest.mjs";
export { sendApiResult } from "./vercel-http.mjs";

async function postingLimits() {
  return import("./posting-limits.mjs");
}

async function azlPrice() {
  return import("./azl-price.mjs");
}

async function posterTasksMod() {
  return import("./poster-tasks.mjs");
}

async function proxyRoleChat(body) {
  const { BANKR_KEY, BANKR_BASE, MODEL } = baseCfg();
  if (!BANKR_KEY) {
    return apiJson(503, { error: "BANKR_API_KEY not configured" });
  }
  const { system, messages } = body;
  if (!system || !Array.isArray(messages)) {
    return apiJson(400, { error: "system and messages required" });
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
    return apiJson(upstream.status, {
      error: "Bankr LLM Gateway error",
      detail: text.slice(0, 500),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return apiJson(502, { error: "Invalid JSON from gateway" });
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  return apiJson(200, { text: content, model: payload.model });
}

/**
 * @param {{ method: string, pathname: string, searchParams: URLSearchParams, body?: unknown }} req
 */
export async function handleSiteApi({ method, pathname, searchParams, body = {} }) {
  const { BANKR_KEY, BANKR_BASE, MODEL, MANIFEST, BILLING_WALLET, BASE_RPC } = baseCfg();

  if (method === "OPTIONS") {
    return { status: 204, headers: CORS, json: null };
  }

  try {
    if (method === "POST" && pathname === "/api/role-chat") {
      return proxyRoleChat(body);
    }

    if (method === "GET" && pathname === "/api/role-chat/health") {
      return apiJson(200, { ok: Boolean(BANKR_KEY), model: MODEL, gateway: BANKR_BASE });
    }

    if (method === "GET" && pathname === "/api/site-config") {
      return buildSiteConfigResponse();
    }

    if (method === "GET" && pathname === "/api/union/overview") {
      try {
        const { getUnionOverview } = await import("../api/lib/union-staking.js");
        return apiJson(200, await getUnionOverview(), {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/plans") {
      return apiJson(200, {
        plans: Object.values(PLANS),
        billingWallet: BILLING_WALLET || null,
        azlPayDiscount: AZL_PAY_DISCOUNT,
      });
    }

    if (method === "GET" && pathname === "/api/posting/azl-price") {
      try {
        const { fetchAzlUsdPrice } = await azlPrice();
        const price = await fetchAzlUsdPrice();
        return apiJson(200, { ...price, discountPercent: AZL_PAY_DISCOUNT * 100 });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/quote") {
      const tier = searchParams.get("tier");
      const address = searchParams.get("address");
      const payWith = searchParams.get("payWith") ?? "azl";
      try {
        if (payWith !== "azl") throw new Error("Only payWith=azl is supported for quotes.");
        const { createUpgradeQuote } = await postingLimits();
        const quote = await createUpgradeQuote({ address, tier });
        return apiJson(200, quote);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/azl-preview") {
      const tier = searchParams.get("tier");
      try {
        const { previewAzlUpgrade } = await postingLimits();
        const preview = await previewAzlUpgrade(tier);
        return apiJson(200, preview);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/posting/quota") {
      const address = searchParams.get("address");
      try {
        const { getQuota } = await postingLimits();
        const quota = await getQuota(address);
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/poster/tasks") {
      const address = searchParams.get("address");
      try {
        const { getPosterTasks } = await posterTasksMod();
        const tasks = await getPosterTasks(address);
        return apiJson(200, { tasks });
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-open-tasks" || pathname === "/api/market/open")) {
      try {
        const { getOpenTasks } = await import("../api/lib/open-tasks.js");
        const limit = searchParams.get("limit");
        const tasks = await getOpenTasks(limit);
        return apiJson(200, { tasks, count: tasks.length }, {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-recent-tasks" || pathname === "/api/market/recent")) {
      try {
        const { getRecentTasks } = await import("../api/lib/recent-tasks.js");
        const limit = searchParams.get("limit");
        const tasks = await getRecentTasks(limit);
        return apiJson(200, { tasks, count: tasks.length }, {
          "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        });
      } catch (e) {
        return apiJson(502, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && pathname === "/api/get-task") {
      try {
        const { getTaskDetail } = await import("../api/lib/task-detail.js");
        const id = searchParams.get("id") ?? searchParams.get("taskId");
        if (!id) return apiJson(400, { error: "Task id required" });
        const task = await getTaskDetail(id);
        if (!task) return apiJson(404, { error: "Task not found" });
        return apiJson(200, { task });
      } catch (e) {
        return apiJson(503, { error: e.message ?? String(e) });
      }
    }

    if (method === "GET" && (pathname === "/api/get-legacy-open-tasks" || pathname === "/api/market/legacy")) {
      try {
        const { listLegacyTasks } = await import("../api/get-legacy-open-tasks.js");
        const limit = searchParams.get("limit");
        return apiJson(200, await listLegacyTasks(limit ?? 100), {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        });
      } catch (e) {
        const message = e.message ?? String(e);
        return apiJson(502, {
          error: /rate limit|429|too many requests/i.test(message)
            ? "legacy_rpc_rate_limited"
            : "legacy_archive_unavailable",
          message,
        });
      }
    }

    if (method === "POST" && (pathname === "/api/posting/record" || pathname === "/api/posting-record")) {
      try {
        const { recordPost } = await postingLimits();
        const quota = await recordPost(body.address, {
          taskId: body.taskId,
          txHash: body.txHash,
          description: body.description,
          budgetUsdc: body.budgetUsdc,
          deadlineDays: body.deadlineDays,
        });
        return apiJson(200, quota);
      } catch (e) {
        const status = e.code === "QUOTA_EXCEEDED" ? 429 : 400;
        return apiJson(status, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && pathname === "/api/posting/check") {
      try {
        const { assertCanPost } = await postingLimits();
        const quota = await assertCanPost(body.address);
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(429, { error: e.message, quota: e.quota ?? null });
      }
    }

    if (method === "POST" && pathname === "/api/posting/upgrade") {
      try {
        if (!BILLING_WALLET) throw new Error("Billing wallet not configured on server.");
        if (!MANIFEST?.external?.usdc) throw new Error("USDC address missing from V2 manifest.");
        const { applyUpgrade } = await postingLimits();
        const quota = await applyUpgrade({
          address: body.address,
          tier: body.tier,
          txHash: body.txHash,
          billingWallet: BILLING_WALLET,
          usdcAddress: MANIFEST.external.usdc,
          azlAddress: MANIFEST.external.azl,
          rpcUrl: BASE_RPC,
          payWith: body.payWith ?? "usdc",
          quoteId: body.quoteId,
        });
        return apiJson(200, quota);
      } catch (e) {
        return apiJson(400, { error: e.message ?? String(e) });
      }
    }

    return apiJson(404, { error: "not_found" });
  } catch (err) {
    return apiJson(500, { error: err.message ?? String(err) });
  }
}

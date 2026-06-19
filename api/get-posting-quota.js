const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLANS = {
  free: { label: "Free", dailyLimit: 3 },
  basic: { label: "Basic", dailyLimit: 50 },
  premium: { label: "Premium", dailyLimit: 300 },
  enterprise: { label: "Enterprise", dailyLimit: null },
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function effectiveTier(user) {
  const tier = user?.tier ?? "free";
  if (tier === "free" || tier === "enterprise") return tier;
  if (!user?.tierExpiresAt) return "free";
  if (Date.now() > Date.parse(user.tierExpiresAt)) return "free";
  return tier;
}

function getQuotaForUser(user) {
  const tier = effectiveTier(user);
  const plan = PLANS[tier] ?? PLANS.free;
  const used = user?.dailyPosts?.[todayKey()] ?? 0;
  const limit = plan.dailyLimit;
  const unlimited = limit == null;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  return {
    tier,
    plan: plan.label,
    used,
    limit: unlimited ? null : limit,
    remaining,
    canPost: unlimited || used < limit,
    tierExpiresAt: user?.tierExpiresAt ?? null,
    upgradeAvailable: tier === "free" || tier === "basic" || tier === "premium",
  };
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const host = req.headers?.host || "azzle.org";
    const url = new URL(req.url || "/api/get-posting-quota", "https://" + host);
    const addr = normAddr(url.searchParams.get("address"));
    if (!addr) throw new Error("Wallet address required");

    const { loadPostingAccounts } = await import("./lib/posting-store.js");
    const store = await loadPostingAccounts();
    const user = store.users[addr] ?? { tier: "free", dailyPosts: {} };
    sendJson(res, 200, getQuotaForUser(user));
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

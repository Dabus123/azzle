const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const AZL_BASE = "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens/" + AZL_BASE;
const COINGECKO =
  "https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=" +
  AZL_BASE +
  "&vs_currencies=usd";
const MAX_AZL_CHECKOUT = 50_000_000;
const MIN_POOL_LIQUIDITY_USD = 5_000;
const AZL_PAY_DISCOUNT = 0.1;

const PLANS = {
  basic: { priceUsdc: 20 },
  premium: { priceUsdc: 60 },
  enterprise: { priceUsdc: 5000 },
};

let cached = null;
const CACHE_MS = 60_000;

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function formatAzlHuman(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B AZL";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M AZL";
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
}

async function fetchDexPrice() {
  const res = await fetch(DEXSCREENER, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("DexScreener HTTP " + res.status);
  const json = await res.json();
  const pairs = (json.pairs ?? [])
    .filter(
      (p) =>
        p.chainId === "base" &&
        p.priceUsd &&
        Number(p.liquidity?.usd ?? 0) >= MIN_POOL_LIQUIDITY_USD
    )
    .sort((a, b) => Number(b.liquidity?.usd ?? 0) - Number(a.liquidity?.usd ?? 0));
  const top = pairs[0];
  const priceUsd = Number(top?.priceUsd);
  if (!priceUsd || priceUsd <= 0) return null;
  return { priceUsd, source: "dexscreener", updatedAt: new Date().toISOString() };
}

async function fetchCoinGeckoPrice() {
  const res = await fetch(COINGECKO, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  const hit = json[AZL_BASE.toLowerCase()];
  const priceUsd = Number(hit?.usd);
  if (!priceUsd || priceUsd <= 0) return null;
  return { priceUsd, source: "coingecko", updatedAt: new Date().toISOString() };
}

async function fetchAzlUsdPrice() {
  const override = process.env.AZL_USD_PRICE;
  if (override) {
    const n = Number(override);
    if (!Number.isFinite(n) || n <= 0) throw new Error("AZL_USD_PRICE must be a positive number");
    return { priceUsd: n, source: "env", updatedAt: new Date().toISOString() };
  }
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const [dex, cg] = await Promise.all([fetchDexPrice(), fetchCoinGeckoPrice()]);
  const pick = dex ?? cg;
  if (!pick) throw new Error("Could not fetch AZL/USD price — try again or pay in USDC.");
  cached = { at: Date.now(), data: pick };
  return pick;
}

function azlTokensForUsd(targetUsd, priceUsd) {
  if (priceUsd <= 0) throw new Error("Invalid AZL price");
  return Math.ceil((targetUsd / priceUsd) * 1e6) / 1e6;
}

function azlWeiForUsd(targetUsd, priceUsd) {
  const tokens = azlTokensForUsd(targetUsd, priceUsd);
  const [whole, frac = ""] = tokens.toFixed(6).split(".");
  const w = BigInt(whole || "0");
  const f = BigInt(frac.padEnd(6, "0").slice(0, 6));
  return (w * 10n ** 18n + f * 10n ** 12n).toString();
}

function azlCheckoutAllowed(azlAmount) {
  if (azlAmount > MAX_AZL_CHECKOUT) {
    return {
      ok: false,
      reason:
        "AZL amount too large for wallet checkout (" +
        formatAzlHuman(azlAmount) +
        ") — pay in USDC for this plan.",
    };
  }
  return { ok: true };
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
    const url = new URL(req.url || "/api/posting/azl-preview", "https://" + host);
    const tier = url.searchParams.get("tier");
    const plan = PLANS[tier];
    if (!plan?.priceUsdc) throw new Error("Invalid upgrade tier");

    const { priceUsd, source, updatedAt } = await fetchAzlUsdPrice();
    const discountedUsd = plan.priceUsdc * (1 - AZL_PAY_DISCOUNT);
    const azlAmount = azlTokensForUsd(discountedUsd, priceUsd);
    const checkout = azlCheckoutAllowed(azlAmount);

    sendJson(res, 200, {
      tier,
      listPriceUsdc: plan.priceUsdc,
      discountedUsd,
      discountPercent: AZL_PAY_DISCOUNT * 100,
      azlUsdPrice: priceUsd,
      azlPriceSource: source,
      azlPriceUpdatedAt: updatedAt,
      azlAmount,
      azlAmountFormatted: formatAzlHuman(azlAmount),
      azlAllowed: checkout.ok,
      azlBlockedReason: checkout.ok ? null : checkout.reason,
      minAzlWei: azlWeiForUsd(discountedUsd, priceUsd),
    });
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

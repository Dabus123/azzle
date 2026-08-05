/** AZL/USD price helpers without viem (safe for Vercel serverless). */
import MANIFEST from "./contracts.json" with { type: "json" };

const AZL_BASE = MANIFEST.external.azl;
const DEXSCREENER = `https://api.dexscreener.com/latest/dex/tokens/${AZL_BASE}`;
const COINGECKO = `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${AZL_BASE}&vs_currencies=usd`;
export const MAX_AZL_CHECKOUT = 50_000_000;
const MIN_POOL_LIQUIDITY_USD = 5_000;

let cached = null;
const CACHE_MS = 60_000;

export function formatAzlHuman(amount) {
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
  return { priceUsd, source: "dexscreener", pair: top.pairAddress ?? null, liquidityUsd: Number(top.liquidity?.usd ?? 0) };
}

async function fetchCoinGeckoPrice() {
  const res = await fetch(COINGECKO, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const json = await res.json();
  const hit = json[AZL_BASE.toLowerCase()];
  const priceUsd = Number(hit?.usd);
  if (!priceUsd || priceUsd <= 0) return null;
  return { priceUsd, source: "coingecko", pair: null, liquidityUsd: null };
}

export async function fetchAzlUsdPrice() {
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
  const data = {
    priceUsd: pick.priceUsd,
    source: pick.source,
    pair: pick.pair,
    liquidityUsd: pick.liquidityUsd,
    coingeckoUsd: cg?.priceUsd ?? null,
    updatedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), data };
  return data;
}

export function azlTokensForUsd(targetUsd, priceUsd) {
  if (priceUsd <= 0) throw new Error("Invalid AZL price");
  return Math.ceil((targetUsd / priceUsd) * 1e6) / 1e6;
}

export function azlWeiForUsd(targetUsd, priceUsd) {
  const tokens = azlTokensForUsd(targetUsd, priceUsd);
  const [whole, frac = ""] = tokens.toFixed(6).split(".");
  const w = BigInt(whole || "0");
  const f = BigInt(frac.padEnd(6, "0").slice(0, 6));
  return (w * 10n ** 18n + f * 10n ** 12n).toString();
}

export function azlCheckoutAllowed(azlAmount) {
  if (azlAmount > MAX_AZL_CHECKOUT) {
    return {
      ok: false,
      reason: "AZL amount too large for wallet checkout (" + formatAzlHuman(azlAmount) + ") — pay in USDC for this plan.",
    };
  }
  return { ok: true };
}

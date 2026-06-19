/**
 * AZL/USD spot price for plan checkout.
 * Uses DexScreener (Base, min liquidity) with CoinGecko cross-check.
 */
import { parseUnits, formatUnits } from "viem";

const AZL_BASE = "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3";
const DEXSCREENER = `https://api.dexscreener.com/latest/dex/tokens/${AZL_BASE}`;
const COINGECKO = `https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${AZL_BASE}&vs_currencies=usd`;

/** Above this, AZL checkout is blocked — use USDC (gas + wallet UX). */
export const MAX_AZL_CHECKOUT = 50_000_000;

const MIN_POOL_LIQUIDITY_USD = 5_000;

let cached = null;
const CACHE_MS = 60_000;

export function formatAzlHuman(amount) {
  const n = typeof amount === "bigint" ? Number(formatUnits(amount, 18)) : Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B AZL";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M AZL";
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
}

async function fetchDexPrice() {
  const res = await fetch(DEXSCREENER, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener HTTP ${res.status}`);
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
  return {
    priceUsd,
    source: "dexscreener",
    pair: top.pairAddress ?? null,
    liquidityUsd: Number(top.liquidity?.usd ?? 0),
  };
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

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.data;
  }

  const [dex, cg] = await Promise.all([fetchDexPrice(), fetchCoinGeckoPrice()]);
  const pick = dex ?? cg;
  if (!pick) {
    throw new Error("Could not fetch AZL/USD price — try again or pay in USDC.");
  }

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

/** Round up token amount so USD value >= targetUsd. */
export function azlTokensForUsd(targetUsd, priceUsd) {
  if (priceUsd <= 0) throw new Error("Invalid AZL price");
  const raw = targetUsd / priceUsd;
  return Math.ceil(raw * 1e6) / 1e6;
}

export function azlWeiForUsd(targetUsd, priceUsd) {
  const tokens = azlTokensForUsd(targetUsd, priceUsd);
  return parseUnits(tokens.toFixed(6), 18);
}

export function azlCheckoutAllowed(azlAmount) {
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

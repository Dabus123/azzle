/**
 * Per-wallet posting tiers + daily quotas (off-chain, enforced before onchain post).
 */
import { createPublicClient, http, parseEventLogs, formatUnits } from "viem";
import { base } from "viem/chains";
import { randomUUID } from "node:crypto";
import { fetchAzlUsdPrice, azlTokensForUsd, azlWeiForUsd, azlCheckoutAllowed, formatAzlHuman } from "./azl-price-lite.js";
import {
  loadPostingAccounts,
  savePostingAccounts,
  loadPostingQuotes,
  savePostingQuotes,
} from "./posting-store.js";
import { PLANS, AZL_PAY_DISCOUNT, QUOTE_TTL_MS } from "./plans.js";

export { PLANS, AZL_PAY_DISCOUNT, QUOTE_TTL_MS };

const ERC20_TRANSFER = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function loadStore() {
  return loadPostingAccounts();
}

async function saveStore(store) {
  await savePostingAccounts(store);
}

async function loadQuotes() {
  return loadPostingQuotes();
}

async function saveQuotes(store) {
  await savePostingQuotes(store);
}

export function discountedUsdForPlan(plan) {
  return plan.priceUsdc * (1 - AZL_PAY_DISCOUNT);
}

export async function createUpgradeQuote({ address, tier }) {
  const addr = normAddr(address);
  const plan = PLANS[tier];
  if (!plan || tier === "free" || !plan.priceUsdc) throw new Error("Invalid upgrade tier");

  const { priceUsd, source, updatedAt } = await fetchAzlUsdPrice();
  const discountedUsd = discountedUsdForPlan(plan);
  const azlAmount = azlTokensForUsd(discountedUsd, priceUsd);
  const checkout = azlCheckoutAllowed(azlAmount);
  if (!checkout.ok) throw new Error(checkout.reason);

  const minAzlWei = azlWeiForUsd(discountedUsd, priceUsd).toString();
  const quoteId = randomUUID();
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  const quote = {
    quoteId,
    address: addr,
    tier,
    payWith: "azl",
    listPriceUsdc: plan.priceUsdc,
    discountedUsd,
    azlUsdPrice: priceUsd,
    azlPriceSource: source,
    azlPriceUpdatedAt: updatedAt,
    azlAmount,
    azlAmountFormatted: formatAzlHuman(azlAmount),
    minAzlWei,
    expiresAt,
    createdAt: new Date().toISOString(),
  };

  const store = await loadQuotes();
  store.quotes[quoteId] = quote;
  await saveQuotes(store);
  return quote;
}

export async function consumeQuote(quoteId, address, tier) {
  const store = await loadQuotes();
  const quote = store.quotes[quoteId];
  if (!quote) throw new Error("Quote expired or not found — refresh price and try again.");
  if (Date.now() > Date.parse(quote.expiresAt)) {
    delete store.quotes[quoteId];
    await saveQuotes(store);
    throw new Error("Quote expired — refresh AZL price and try again.");
  }
  if (normAddr(quote.address) !== normAddr(address)) throw new Error("Quote wallet mismatch.");
  if (quote.tier !== tier) throw new Error("Quote plan mismatch.");
  delete store.quotes[quoteId];
  await saveQuotes(store);
  return quote;
}

export async function previewAzlUpgrade(tier) {
  const plan = PLANS[tier];
  if (!plan || !plan.priceUsdc) throw new Error("Invalid upgrade tier");
  const { priceUsd, source, updatedAt } = await fetchAzlUsdPrice();
  const discountedUsd = discountedUsdForPlan(plan);
  const azlAmount = azlTokensForUsd(discountedUsd, priceUsd);
  const checkout = azlCheckoutAllowed(azlAmount);
  return {
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
    minAzlWei: azlWeiForUsd(discountedUsd, priceUsd).toString(),
  };
}

function effectiveTier(user) {
  const tier = user?.tier ?? "free";
  if (tier === "free" || tier === "enterprise") return tier;
  if (!user?.tierExpiresAt) return "free";
  if (Date.now() > Date.parse(user.tierExpiresAt)) return "free";
  return tier;
}

function dailyCount(user) {
  const key = todayKey();
  return user?.dailyPosts?.[key] ?? 0;
}

export function getQuotaForUser(user) {
  const tier = effectiveTier(user);
  const plan = PLANS[tier] ?? PLANS.free;
  const used = dailyCount(user);
  const limit = plan.dailyLimit;
  const unlimited = limit == null;
  const remaining = unlimited ? null : Math.max(0, limit - used);
  const canPost = unlimited || used < limit;

  return {
    tier,
    plan: plan.label,
    used,
    limit: unlimited ? null : limit,
    remaining,
    canPost,
    tierExpiresAt: user?.tierExpiresAt ?? null,
    upgradeAvailable: tier === "free" || tier === "basic" || tier === "premium",
  };
}

export async function getQuota(address) {
  const addr = normAddr(address);
  if (!addr) throw new Error("Wallet address required");
  const store = await loadStore();
  const user = store.users[addr] ?? { tier: "free", dailyPosts: {} };
  return getQuotaForUser(user);
}

export async function recordPost(address, { taskId, txHash } = {}) {
  const addr = normAddr(address);
  if (!addr) throw new Error("Wallet address required");
  const store = await loadStore();
  const user = store.users[addr] ?? { tier: "free", dailyPosts: {} };
  const quota = getQuotaForUser(user);
  if (!quota.canPost) {
    const err = new Error("Daily posting limit reached — upgrade your plan.");
    err.code = "QUOTA_EXCEEDED";
    err.quota = quota;
    throw err;
  }
  const key = todayKey();
  user.dailyPosts = user.dailyPosts ?? {};
  user.dailyPosts[key] = (user.dailyPosts[key] ?? 0) + 1;
  user.lastPost = {
    at: new Date().toISOString(),
    taskId: taskId ?? null,
    txHash: txHash ?? null,
  };
  store.users[addr] = user;
  await saveStore(store);
  return getQuotaForUser(user);
}

export async function assertCanPost(address) {
  const quota = await getQuota(address);
  if (!quota.canPost) {
    const err = new Error("Daily posting limit reached — upgrade your plan.");
    err.code = "QUOTA_EXCEEDED";
    err.quota = quota;
    throw err;
  }
  return quota;
}

export async function verifyUsdcPayment({
  txHash,
  fromAddress,
  toAddress,
  usdcAddress,
  minAmountUsdc,
  rpcUrl,
}) {
  const from = normAddr(fromAddress);
  const to = normAddr(toAddress);
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl ?? "https://mainnet.base.org"),
  });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Payment transaction failed onchain.");

  const logs = parseEventLogs({
    abi: ERC20_TRANSFER,
    logs: receipt.logs,
    eventName: "Transfer",
  });
  const minWei = BigInt(Math.round(minAmountUsdc * 1e6));
  const hit = logs.find(
    (log) =>
      log.address.toLowerCase() === usdcAddress.toLowerCase() &&
      normAddr(log.args.from) === from &&
      normAddr(log.args.to) === to &&
      log.args.value >= minWei
  );
  if (!hit) {
    throw new Error(
      "Payment not found — send exactly $" +
        minAmountUsdc +
        " USDC to the billing wallet, then try again."
    );
  }
  return { amount: formatUnits(hit.args.value, 6) };
}

export async function verifyAzlPayment({
  txHash,
  fromAddress,
  toAddress,
  azlAddress,
  minAzlWei,
  rpcUrl,
}) {
  const from = normAddr(fromAddress);
  const to = normAddr(toAddress);
  const minWei = BigInt(minAzlWei);
  const client = createPublicClient({
    chain: base,
    transport: http(rpcUrl ?? "https://mainnet.base.org"),
  });
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") throw new Error("Payment transaction failed onchain.");

  const logs = parseEventLogs({
    abi: ERC20_TRANSFER,
    logs: receipt.logs,
    eventName: "Transfer",
  });
  const hit = logs.find(
    (log) =>
      log.address.toLowerCase() === azlAddress.toLowerCase() &&
      normAddr(log.args.from) === from &&
      normAddr(log.args.to) === to &&
      log.args.value >= minWei
  );
  if (!hit) {
    throw new Error(
      "AZL payment not found — send at least " +
        formatUnits(minWei, 18) +
        " AZL to the billing wallet, then try again."
    );
  }
  return { amount: formatUnits(hit.args.value, 18) };
}

export async function applyUpgrade({
  address,
  tier,
  txHash,
  billingWallet,
  usdcAddress,
  azlAddress,
  rpcUrl,
  payWith = "usdc",
  quoteId,
}) {
  const addr = normAddr(address);
  const plan = PLANS[tier];
  if (!plan || tier === "free") throw new Error("Invalid upgrade tier");
  if (!txHash) throw new Error("Payment transaction hash required");

  if (payWith === "azl") {
    if (!azlAddress) throw new Error("AZL token address missing from manifest.");
    const quote = await consumeQuote(quoteId, addr, tier);
    await verifyAzlPayment({
      txHash,
      fromAddress: addr,
      toAddress: billingWallet,
      azlAddress,
      minAzlWei: quote.minAzlWei,
      rpcUrl,
    });
  } else {
    await verifyUsdcPayment({
      txHash,
      fromAddress: addr,
      toAddress: billingWallet,
      usdcAddress,
      minAmountUsdc: plan.priceUsdc,
      rpcUrl,
    });
  }

  const store = await loadStore();
  const user = store.users[addr] ?? { tier: "free", dailyPosts: {} };
  user.tier = tier;
  user.upgradedAt = new Date().toISOString();
  user.upgradeTx = txHash;
  user.upgradePayWith = payWith;

  if (plan.billing === "monthly") {
    const expires = new Date();
    expires.setUTCDate(expires.getUTCDate() + 30);
    user.tierExpiresAt = expires.toISOString();
  } else {
    user.tierExpiresAt = null;
  }

  store.users[addr] = user;
  await saveStore(store);
  return getQuotaForUser(user);
}

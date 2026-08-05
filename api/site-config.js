import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const MANIFEST = require("../contracts/deployments/base-8453.json");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLANS = [
  { id: "free", label: "Free", dailyLimit: 3, priceUsdc: 0, billing: "none", description: "3 tasks per day" },
  { id: "basic", label: "Basic", dailyLimit: 50, priceUsdc: 20, billing: "monthly", description: "50 tasks per day · $20 USDC/month" },
  { id: "premium", label: "Premium", dailyLimit: 300, priceUsdc: 60, billing: "monthly", description: "300 tasks per day · $60 USDC/month" },
  { id: "enterprise", label: "Enterprise", dailyLimit: null, priceUsdc: 5000, billing: "lifetime", description: "Unlimited · one-time $5,000 USDC" },
];

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function postingStoreBackend() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "redis";
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "redis";
  return "file";
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const billingWallet = process.env.AZZLE_BILLING_WALLET || MANIFEST.governance || "";
  const taskScopeRegistry =
    process.env.NEXT_TASK_SCOPE_ADDRESS?.trim() || MANIFEST.taskScopeRegistry || null;

  sendJson(res, 200, {
    privyAppId: process.env.PRIVY_APP_ID || "",
    privyClientId: process.env.PRIVY_CLIENT_ID || "",
    chainId: Number(MANIFEST.chainId),
    chainName: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    contracts: {
      usdc: MANIFEST.external.usdc,
      azlToken: MANIFEST.external.azl,
      taskRegistry: MANIFEST.taskRegistry,
      depositVault: MANIFEST.depositVault,
      treasuryRouter: MANIFEST.treasuryRouter,
      escrowVault: MANIFEST.escrowVault,
      stakingVault: MANIFEST.stakingVault,
      arbitrationModule: MANIFEST.arbitrationModule,
      reputationRegistry: MANIFEST.reputationRegistry,
      verifierBondVault: MANIFEST.verifierBondVault,
      usdOracle: MANIFEST.usdOracle,
      pricingPolicy: MANIFEST.pricingPolicy,
      paymentGateway: MANIFEST.paymentGateway,
      taskScopeRegistry,
      observationOracle: MANIFEST.observationOracle,
      twapAdapter: MANIFEST.twapAdapter,
      usdcWethLeg: MANIFEST.usdcWethLeg,
      exactInputExecutor: MANIFEST.exactInputExecutor,
      factory: MANIFEST.factory,
      governance: MANIFEST.governance,
      external: MANIFEST.external,
      risk: MANIFEST.risk,
      actionCredits: MANIFEST.actionCredits,
    },
    v2: true,
    taskUnit: "AZL",
    taskStates: ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"],
    economics: {
      entryDepositUsd: 25,
      liveTaskReserveUsd: 8,
      accessFeeUsd: 5,
      exitCompensationUsd: 2.5,
      exitProtocolShareUsd: 2.5,
      accessFee: "oracle-derived AZL via AzlPricingPolicy.accessFeeAzl()",
    },
    billingWallet: billingWallet || null,
    postingPlans: PLANS,
    azlPayDiscount: 0.1,
    postingStore: postingStoreBackend(),
  });
}

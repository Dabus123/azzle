const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MANIFEST = {
  chainId: "8453",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  azlToken: "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3",
  feeRecipient: "0x41f35485Dea9e5e7C683d1C6CA650e8179c606ba",
  EscrowVault: "0xd1f3058650ab22250d139dba5b2b48118071dc36",
  TaskRegistry: "0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48",
  TreasuryRouter: "0x6bEBf56a67c8B38cB4d8FF328252FbE9662201b6",
  AgentDepositVault: "0x62808379CbDEfe7E8b2FcD659158E49463c34e5D",
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

  const billingWallet = process.env.AZZLE_BILLING_WALLET || MANIFEST.feeRecipient || "";

  sendJson(res, 200, {
    privyAppId: process.env.PRIVY_APP_ID || "",
    privyClientId: process.env.PRIVY_CLIENT_ID || "",
    chainId: Number(MANIFEST.chainId),
    chainName: "Base",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
    contracts: {
      usdc: MANIFEST.usdc,
      azlToken: MANIFEST.azlToken,
      TaskRegistry: MANIFEST.TaskRegistry,
      AgentDepositVault: MANIFEST.AgentDepositVault,
      TreasuryRouter: MANIFEST.TreasuryRouter,
      EscrowVault: MANIFEST.EscrowVault,
    },
    billingWallet: billingWallet || null,
    postingPlans: PLANS,
    azlPayDiscount: 0.1,
    postingStore: postingStoreBackend(),
  });
}

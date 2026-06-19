import { PLANS, AZL_PAY_DISCOUNT } from "./lib/plans.js";
import { loadManifest } from "./lib/manifest.js";
import { CORS, sendJson } from "./lib/respond.js";

function postingStoreBackend() {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) return "redis";
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return "redis";
  return "file";
}

export default function handler(req, res) {
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

    const MANIFEST = loadManifest();
    const billingWallet =
      process.env.AZZLE_BILLING_WALLET || MANIFEST?.feeRecipient || "";

    sendJson(res, 200, {
      privyAppId: process.env.PRIVY_APP_ID || "",
      privyClientId: process.env.PRIVY_CLIENT_ID || "",
      chainId: Number(MANIFEST?.chainId ?? 8453),
      chainName: "Base",
      rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
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
      billingWallet: billingWallet || null,
      postingPlans: Object.values(PLANS),
      azlPayDiscount: AZL_PAY_DISCOUNT,
      postingStore: postingStoreBackend(),
    });
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

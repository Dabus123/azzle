import { PLANS, AZL_PAY_DISCOUNT } from "./posting-plans.mjs";
import { baseCfg } from "./manifest.mjs";
import { postingStoreBackend } from "./posting-store.mjs";
import { apiJson } from "./vercel-http.mjs";

export function buildSiteConfigResponse() {
  const {
    PRIVY_APP_ID,
    PRIVY_CLIENT_ID,
    BASE_RPC,
    MANIFEST,
    BILLING_WALLET,
  } = baseCfg();

  return apiJson(200, {
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

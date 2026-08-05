import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface BaseMainnetV2Manifest {
  version: "2.0.0";
  chainId: "8453";
  deploymentBlock: number;
  deployer: string;
  governance: string;
  factory: string;
  observationOracle: string;
  twapAdapter: string;
  usdOracle: string;
  pricingPolicy: string;
  depositVault: string;
  escrowVault: string;
  reputationRegistry: string;
  verifierBondVault: string;
  stakingVault: string;
  treasuryRouter: string;
  taskRegistry: string;
  arbitrationModule: string;
  usdcWethLeg: string;
  exactInputExecutor: string;
  paymentGateway: string;
  taskScopeRegistry: string;
  external: {
    usdc: string;
    weth: string;
    azl: string;
    poolManager: string;
    universalRouter: string;
    hook: string;
    ethUsdFeed: string;
    poolId: string;
  };
  risk: Record<string, string | number>;
  actionCredits?: {
    activationRequired: boolean;
    creditUnit: string;
    lifetimeCap: string;
    baseStakeAzl: string;
    issuancePeriodSeconds: number;
  };
}

/** Loads the canonical V2 manifest shipped with the SDK, with an explicit override for deployments. */
export function loadBaseMainnetV2Manifest(path = process.env.AZZLE_V2_MANIFEST): BaseMainnetV2Manifest {
  const manifestPath = path ?? resolve(new URL("../../deployments/base-8453.json", import.meta.url).pathname);
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8")) as BaseMainnetV2Manifest;
  if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
    throw new Error("AZZLE V2: invalid manifest version or chain");
  }
  return manifest;
}
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BaseMainnetManifest {
  version: "2.0.0";
  chainId: string;
  deployer: string;
  governance: string;
  factory: string;
  treasuryRouter: string;
  observationOracle: string;
  twapAdapter: string;
  usdOracle: string;
  pricingPolicy: string;
  depositVault: string;
  escrowVault: string;
  reputationRegistry: string;
  verifierBondVault: string;
  stakingVault: string;
  taskRegistry: string;
  arbitrationModule: string;
  usdcWethLeg: string;
  exactInputExecutor: string;
  paymentGateway: string;
  taskScopeRegistry: string;
  external: {
    chainId: string;
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

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../deployments/base-8453.json"
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BaseMainnetManifest;
if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
  throw new Error("AZZLE: canonical manifest is not the V2 Base deployment");
}

/** Canonical Base mainnet (8453) deployment manifest shipped with @azzle/agents. */
export const BASE_MAINNET_MANIFEST: BaseMainnetManifest = manifest;

export default BASE_MAINNET_MANIFEST;

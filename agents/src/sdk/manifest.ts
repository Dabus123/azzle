import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BaseMainnetManifest {
  chainId: string;
  network: string;
  usdc: string;
  azlToken: string;
  feeRecipient: string;
  deployer: string;
  EscrowVault: string;
  TaskRegistry: string;
  ReputationRegistry: string;
  ArbitrationModule: string;
  TreasuryRouter: string;
  AgentDepositVault: string;
}

const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../deployments/base-8453.json"
);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BaseMainnetManifest;

/** Canonical Base mainnet (8453) deployment manifest shipped with @azzle/agents. */
export const BASE_MAINNET_MANIFEST: BaseMainnetManifest = manifest;

export default BASE_MAINNET_MANIFEST;

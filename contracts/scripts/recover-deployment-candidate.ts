/**
 * Recover a fully deployed/wired suite whose final candidate-manifest write
 * failed. This is read-only onchain and never modifies the canonical manifest.
 *
 * Requires all deployed suite addresses in .env, as documented in .env.example.
 * Usage:
 *   npx hardhat run scripts/recover-deployment-candidate.ts --network base
 */
import { ethers } from "hardhat";
import {
  SuiteManifest,
  requireAddress,
  writeValidatedCandidate,
} from "./suite-manifest";
import { readArbitrationSatellite } from "./wire-satellite";

async function main() {
  const network = await ethers.provider.getNetwork();
  const netName = process.env.HARDHAT_NETWORK ?? network.name;
  const [signer] = await ethers.getSigners();
  const read = (key: string) => requireAddress(key, process.env[key]?.trim());
  const usdc =
    process.env.USDC_ADDRESS?.trim() ??
    (network.chainId === 8453n
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      : undefined);

  const arbitrationModule = read("ARBITRATION_MODULE_ADDRESS");
  const satelliteAddress =
    process.env.ARBITRATION_SATELLITE_ADDRESS?.trim() ||
    (await readArbitrationSatellite(arbitrationModule));

  const out: SuiteManifest = {
    chainId: network.chainId.toString(),
    network: netName,
    usdc: requireAddress("USDC_ADDRESS", usdc),
    azlToken: read("AZL_TOKEN_ADDRESS"),
    feeRecipient: read("FEE_RECIPIENT"),
    buybackExecutor: read("BUYBACK_EXECUTOR"),
    fallbackResolver: read("FALLBACK_RESOLVER"),
    deployer: signer.address,
    EscrowVault: read("ESCROW_VAULT_ADDRESS"),
    TaskRegistry: read("TASK_REGISTRY_ADDRESS"),
    ReputationRegistry: read("REPUTATION_REGISTRY_ADDRESS"),
    ArbitrationModule: arbitrationModule,
    ArbitrationSatellite: requireAddress(
      "ARBITRATION_SATELLITE_ADDRESS",
      satelliteAddress
    ),
    ArbitrationRecoveryCoordinator: read(
      "ARBITRATION_RECOVERY_COORDINATOR_ADDRESS"
    ),
    TreasuryRouter: read("TREASURY_ROUTER_ADDRESS"),
    AgentDepositVault: read("AGENT_DEPOSIT_VAULT_ADDRESS"),
    UnionStakingVault: read("UNION_STAKING_VAULT_ADDRESS"),
    TaskScopeRegistry: read("TASK_SCOPE_REGISTRY_ADDRESS"),
  };

  const candidate = await writeValidatedCandidate(out);
  console.log(JSON.stringify(out, null, 2));
  console.log(`\nRecovered validated candidate manifest: ${candidate}`);
  console.log("Canonical live manifest was not modified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Verify AZZLE contracts on BaseScan (requires BASESCAN_API_KEY in .env).
 * Get a free key: https://basescan.org/myapikey
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";

const DEPLOY_PATH = path.join(__dirname, "..", "deployments", "base-8453.json");

type DeployManifest = {
  chainId: string;
  escrowVault: string;
  taskRegistry: string;
  reputationRegistry: string;
  arbitrationModule: string;
  treasuryRouter: string;
  depositVault: string;
  stakingVault: string;
  taskScopeRegistry: string;
  external: { azl: string; usdc: string };
};

async function verify(
  name: string,
  contract: string,
  address: string,
  constructorArguments: unknown[] = []
) {
  console.log(`\nVerifying ${name} at ${address}...`);
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
      contract,
    });
    console.log(`  OK: ${name}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log(`  Already verified: ${name}`);
      return;
    }
    console.error(`  FAILED: ${name}\n`, msg);
    throw e;
  }
}

async function main() {
  const apiKey =
    process.env.ETHERSCAN_API_KEY?.trim() || process.env.BASESCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Set ETHERSCAN_API_KEY in contracts/.env (free: https://etherscan.io/apidashboard — works for Base via API v2)"
    );
  }

  const raw = fs.readFileSync(DEPLOY_PATH, "utf8");
  const d = JSON.parse(raw) as DeployManifest;
  const network = await hre.ethers.provider.getNetwork();
  if (network.chainId.toString() !== d.chainId) {
    throw new Error(`Connected chain ${network.chainId}, manifest chain ${d.chainId}`);
  }
  for (const [name, address] of Object.entries({
    escrowVault: d.escrowVault,
    taskRegistry: d.taskRegistry,
    reputationRegistry: d.reputationRegistry,
    arbitrationModule: d.arbitrationModule,
    treasuryRouter: d.treasuryRouter,
    depositVault: d.depositVault,
    stakingVault: d.stakingVault,
    taskScopeRegistry: d.taskScopeRegistry,
  })) {
    if (!hre.ethers.isAddress(address) || (await hre.ethers.provider.getCode(address)) === "0x") {
      throw new Error(`${name} has no deployed code at ${address}`);
    }
  }

  await verify("EscrowVaultV2", "src/v2/EscrowVaultV2.sol:EscrowVaultV2", d.escrowVault, []);
  await verify("TaskRegistryV2", "src/v2/TaskRegistryV2.sol:TaskRegistryV2", d.taskRegistry, []);
  await verify("ReputationRegistryV2", "src/v2/ReputationRegistryV2.sol:ReputationRegistryV2", d.reputationRegistry, []);
  await verify("ArbitrationModuleV2", "src/v2/ArbitrationModuleV2.sol:ArbitrationModuleV2", d.arbitrationModule, []);
  await verify("TreasuryRouterV2", "src/v2/TreasuryRouterV2.sol:TreasuryRouterV2", d.treasuryRouter, []);
  await verify("AgentDepositVaultV2", "src/v2/AgentDepositVaultV2.sol:AgentDepositVaultV2", d.depositVault, []);
  await verify("UnionStakingVaultV2", "src/v2/UnionStakingVaultV2.sol:UnionStakingVaultV2", d.stakingVault, []);
  await verify("TaskScopeRegistryV2", "src/v2/TaskScopeRegistryV2.sol:TaskScopeRegistryV2", d.taskScopeRegistry, []);

  console.log("\nAll verifications submitted. Check BaseScan in ~30s:");
  console.log(`  https://basescan.org/address/${d.taskRegistry}#code`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

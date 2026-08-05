/**
 * Print Onchain wiring for a partial or complete Base deploy.
 * Set all contract addresses in .env (see .env.example).
 */
import { ethers } from "hardhat";

async function main() {
  const escrowAddress = process.env.ESCROW_VAULT_ADDRESS?.trim();
  const registryAddress = process.env.TASK_REGISTRY_ADDRESS?.trim();
  const reputationAddress = process.env.REPUTATION_REGISTRY_ADDRESS?.trim();
  const arbitrationAddress = process.env.ARBITRATION_MODULE_ADDRESS?.trim();
  const treasuryAddress = process.env.TREASURY_ROUTER_ADDRESS?.trim();
  const agentVaultAddress = process.env.AGENT_DEPOSIT_VAULT_ADDRESS?.trim();
  const recoveryAddress = process.env.ARBITRATION_RECOVERY_COORDINATOR_ADDRESS?.trim();
  const stakingAddress = process.env.UNION_STAKING_VAULT_ADDRESS?.trim();
  const taskScopeAddress = process.env.TASK_SCOPE_REGISTRY_ADDRESS?.trim();
  const azlToken = process.env.AZL_TOKEN_ADDRESS?.trim();
  const buybackExecutor = process.env.BUYBACK_EXECUTOR?.trim();
  const fallbackResolver = process.env.FALLBACK_RESOLVER?.trim();

  const required = {
    ESCROW_VAULT_ADDRESS: escrowAddress,
    TASK_REGISTRY_ADDRESS: registryAddress,
    REPUTATION_REGISTRY_ADDRESS: reputationAddress,
    ARBITRATION_MODULE_ADDRESS: arbitrationAddress,
    TREASURY_ROUTER_ADDRESS: treasuryAddress,
    AGENT_DEPOSIT_VAULT_ADDRESS: agentVaultAddress,
    ARBITRATION_RECOVERY_COORDINATOR_ADDRESS: recoveryAddress,
    UNION_STAKING_VAULT_ADDRESS: stakingAddress,
    TASK_SCOPE_REGISTRY_ADDRESS: taskScopeAddress,
    AZL_TOKEN_ADDRESS: azlToken,
    BUYBACK_EXECUTOR: buybackExecutor,
    FALLBACK_RESOLVER: fallbackResolver,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Complete wiring inspection requires: ${missing.join(", ")}`);
  }

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress!);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress!);

  console.log("EscrowVault.taskRegistry:", await escrow.taskRegistry());
  console.log("EscrowVault.arbitrationModule:", await escrow.arbitrationModule());
  console.log("TaskRegistry.arbitration:", await registry.arbitration());
  console.log("TaskRegistry.treasury:", await registry.treasury());
  console.log("TaskRegistry.agentVault:", await registry.agentVault());
  console.log("TaskRegistry.reputation:", await registry.reputation());
  console.log("TaskRegistry.stakingVault:", await registry.stakingVault());
  console.log(
    "TaskRegistry.arbitrationRecoveryCoordinator:",
    await registry.arbitrationRecoveryCoordinator()
  );

  if (reputationAddress) {
    const reputation = await ethers.getContractAt("ReputationRegistry", reputationAddress);
    console.log("ReputationRegistry.taskRegistry:", await reputation.taskRegistry());
    console.log("ReputationRegistry.arbitrationModule:", await reputation.arbitrationModule());
    console.log("ReputationRegistry.agentDepositVault:", await reputation.agentDepositVault());
    console.log("ReputationRegistry.treasury:", await reputation.treasury());
    console.log(
      "ReputationRegistry.arbitrationRecoveryCoordinator:",
      await reputation.arbitrationRecoveryCoordinator()
    );
    console.log("ReputationRegistry.arbitrationSatellite:", await reputation.arbitrationSatellite());
  }

  if (arbitrationAddress) {
    const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress);
    console.log("ArbitrationModule.reputationRegistry:", await arbitration.reputationRegistry());
    console.log("ArbitrationModule.agentDepositVault:", await arbitration.agentDepositVault());
    console.log("ArbitrationModule.fallbackResolver:", await arbitration.fallbackResolver());
    console.log("ArbitrationModule.arbitrationSatellite:", await arbitration.arbitrationSatellite());
  }

  if (treasuryAddress) {
    const treasury = await ethers.getContractAt("TreasuryRouter", treasuryAddress);
    console.log("TreasuryRouter.agentDepositVault:", await treasury.agentDepositVault());
    console.log("TreasuryRouter.reputationRegistry:", await treasury.reputationRegistry());
    console.log("TreasuryRouter.azlToken:", await treasury.azlToken());
    console.log("TreasuryRouter.stakingVault:", await treasury.stakingVault());
    console.log("TreasuryRouter.buybackExecutor:", await treasury.buybackExecutor());
  }

  if (agentVaultAddress) {
    const agentVault = await ethers.getContractAt("AgentDepositVault", agentVaultAddress);
    console.log("AgentDepositVault.taskRegistry:", await agentVault.taskRegistry());
    console.log("AgentDepositVault.treasury:", await agentVault.treasury());
    console.log("AgentDepositVault.reputationRegistry:", await agentVault.reputationRegistry());
    console.log("AgentDepositVault.arbitrationModule:", await agentVault.arbitrationModule());
    console.log(
      "AgentDepositVault.arbitrationRecoveryCoordinator:",
      await agentVault.arbitrationRecoveryCoordinator()
    );
  }

  const reputation = await ethers.getContractAt("ReputationRegistry", reputationAddress!);
  const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress!);
  const treasury = await ethers.getContractAt("TreasuryRouter", treasuryAddress!);
  const agentVault = await ethers.getContractAt("AgentDepositVault", agentVaultAddress!);
  const recovery = await ethers.getContractAt("ArbitrationRecoveryCoordinator", recoveryAddress!);
  const staking = await ethers.getContractAt("UnionStakingVault", stakingAddress!);
  const scope = await ethers.getContractAt("TaskScopeRegistry", taskScopeAddress!);
  for (const [name, address] of Object.entries({
    EscrowVault: escrowAddress,
    TaskRegistry: registryAddress,
    ReputationRegistry: reputationAddress,
    ArbitrationModule: arbitrationAddress,
    TreasuryRouter: treasuryAddress,
    AgentDepositVault: agentVaultAddress,
    ArbitrationRecoveryCoordinator: recoveryAddress,
    UnionStakingVault: stakingAddress,
    TaskScopeRegistry: taskScopeAddress,
  })) {
    if ((await ethers.provider.getCode(address!)) === "0x") {
      throw new Error(`${name} has no deployed code at ${address}`);
    }
  }
  const eq = (actual: string, expected: string | undefined) =>
    !!expected && actual.toLowerCase() === expected.toLowerCase();
  const checks = [
    eq(await escrow.taskRegistry(), registryAddress),
    eq(await escrow.arbitrationModule(), arbitrationAddress),
    eq(await escrow.arbitrationRecoveryCoordinator(), recoveryAddress),
    eq(await registry.arbitration(), arbitrationAddress),
    eq(await registry.treasury(), treasuryAddress),
    eq(await registry.agentVault(), agentVaultAddress),
    eq(await registry.reputation(), reputationAddress),
    eq(await registry.stakingVault(), stakingAddress),
    eq(await registry.arbitrationRecoveryCoordinator(), recoveryAddress),
    eq(await reputation.taskRegistry(), registryAddress),
    eq(await reputation.arbitrationModule(), arbitrationAddress),
    eq(await reputation.agentDepositVault(), agentVaultAddress),
    eq(await reputation.treasury(), treasuryAddress),
    eq(await reputation.arbitrationRecoveryCoordinator(), recoveryAddress),
    eq(await arbitration.reputationRegistry(), reputationAddress),
    eq(await arbitration.agentDepositVault(), agentVaultAddress),
    eq(await arbitration.fallbackResolver(), fallbackResolver),
    (await arbitration.arbitrationSatellite()).toLowerCase() ===
      (await reputation.arbitrationSatellite()).toLowerCase() &&
      (await arbitration.arbitrationSatellite()) !== ethers.ZeroAddress,
    eq(await treasury.agentDepositVault(), agentVaultAddress),
    eq(await treasury.reputationRegistry(), reputationAddress),
    eq(await treasury.azlToken(), azlToken),
    eq(await treasury.stakingVault(), stakingAddress),
    eq(await treasury.buybackExecutor(), buybackExecutor),
    eq(await agentVault.taskRegistry(), registryAddress),
    eq(await agentVault.treasury(), treasuryAddress),
    eq(await agentVault.reputationRegistry(), reputationAddress),
    eq(await agentVault.arbitrationModule(), arbitrationAddress),
    eq(await agentVault.arbitrationRecoveryCoordinator(), recoveryAddress),
    eq(await recovery.taskRegistry(), registryAddress),
    eq(await recovery.escrow(), escrowAddress),
    eq(await recovery.agentDepositVault(), agentVaultAddress),
    eq(await recovery.reputationRegistry(), reputationAddress),
    eq(await staking.taskRegistry(), registryAddress),
    eq(await staking.treasury(), treasuryAddress),
    eq(await staking.azlToken(), azlToken),
  ];
  console.log("TaskScopeRegistry.taskRegistry:", await scope.taskRegistry());
  checks.push(eq(await scope.taskRegistry(), registryAddress));
  const complete = checks.every(Boolean);

  console.log("\nWiring complete:", complete);
  if (!complete) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

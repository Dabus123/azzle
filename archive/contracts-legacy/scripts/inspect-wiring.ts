/**
 * Print Onchain wiring for a partial or complete Base deploy.
 * Set all contract addresses in .env (see .env.example).
 */
import { ethers } from "hardhat";
import { isZero } from "./deploy-utils";

async function main() {
  const escrowAddress = process.env.ESCROW_VAULT_ADDRESS?.trim();
  const registryAddress = process.env.TASK_REGISTRY_ADDRESS?.trim();
  const reputationAddress = process.env.REPUTATION_REGISTRY_ADDRESS?.trim();
  const arbitrationAddress = process.env.ARBITRATION_MODULE_ADDRESS?.trim();
  const treasuryAddress = process.env.TREASURY_ROUTER_ADDRESS?.trim();
  const agentVaultAddress = process.env.AGENT_DEPOSIT_VAULT_ADDRESS?.trim();

  if (!escrowAddress || !registryAddress) {
    throw new Error("ESCROW_VAULT_ADDRESS and TASK_REGISTRY_ADDRESS required");
  }

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress);

  console.log("EscrowVault.taskRegistry:", await escrow.taskRegistry());
  console.log("EscrowVault.arbitrationModule:", await escrow.arbitrationModule());
  console.log("TaskRegistry.arbitration:", await registry.arbitration());
  console.log("TaskRegistry.treasury:", await registry.treasury());
  console.log("TaskRegistry.agentVault:", await registry.agentVault());

  if (reputationAddress) {
    const reputation = await ethers.getContractAt("ReputationRegistry", reputationAddress);
    console.log("ReputationRegistry.taskRegistry:", await reputation.taskRegistry());
    console.log("ReputationRegistry.arbitrationModule:", await reputation.arbitrationModule());
    console.log("ReputationRegistry.agentDepositVault:", await reputation.agentDepositVault());
    console.log("ReputationRegistry.treasury:", await reputation.treasury());
  }

  if (arbitrationAddress) {
    const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress);
    console.log("ArbitrationModule.reputationRegistry:", await arbitration.reputationRegistry());
    console.log("ArbitrationModule.agentDepositVault:", await arbitration.agentDepositVault());
  }

  if (treasuryAddress) {
    const treasury = await ethers.getContractAt("TreasuryRouter", treasuryAddress);
    console.log("TreasuryRouter.agentDepositVault:", await treasury.agentDepositVault());
    console.log("TreasuryRouter.reputationRegistry:", await treasury.reputationRegistry());
    console.log("TreasuryRouter.azlToken:", await treasury.azlToken());
  }

  if (agentVaultAddress) {
    const agentVault = await ethers.getContractAt("AgentDepositVault", agentVaultAddress);
    console.log("AgentDepositVault.taskRegistry:", await agentVault.taskRegistry());
    console.log("AgentDepositVault.treasury:", await agentVault.treasury());
    console.log("AgentDepositVault.reputationRegistry:", await agentVault.reputationRegistry());
  }

  const complete =
    !isZero(await escrow.arbitrationModule()) &&
    !isZero(await registry.arbitration()) &&
    !isZero(await registry.treasury()) &&
    !isZero(String(await registry.agentVault())) &&
    treasuryAddress &&
    !isZero(await (await ethers.getContractAt("TreasuryRouter", treasuryAddress)).azlToken()) &&
    agentVaultAddress &&
    !isZero(await (await ethers.getContractAt("AgentDepositVault", agentVaultAddress)).taskRegistry());

  console.log("\nWiring complete:", complete);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Idempotent wiring finish — skips setters already applied Onchain.
 * Set all six contract addresses in .env (see .env.example).
 */
import { ethers } from "hardhat";
import { confirm, isZero } from "./deploy-utils";

async function main() {
  const feeRecipient = process.env.FEE_RECIPIENT;
  if (!feeRecipient) throw new Error("FEE_RECIPIENT required");

  const azlToken = process.env.AZL_TOKEN_ADDRESS;
  if (!azlToken) throw new Error("AZL_TOKEN_ADDRESS required");

  const escrowAddress = process.env.ESCROW_VAULT_ADDRESS?.trim();
  const registryAddress = process.env.TASK_REGISTRY_ADDRESS?.trim();
  const reputationAddress = process.env.REPUTATION_REGISTRY_ADDRESS?.trim();
  const arbitrationAddress = process.env.ARBITRATION_MODULE_ADDRESS?.trim();
  const treasuryAddress = process.env.TREASURY_ROUTER_ADDRESS?.trim();
  const agentVaultAddress = process.env.AGENT_DEPOSIT_VAULT_ADDRESS?.trim();

  if (
    !escrowAddress ||
    !registryAddress ||
    !reputationAddress ||
    !arbitrationAddress ||
    !treasuryAddress ||
    !agentVaultAddress
  ) {
    throw new Error(
      "Set ESCROW_VAULT_ADDRESS, TASK_REGISTRY_ADDRESS, REPUTATION_REGISTRY_ADDRESS, ARBITRATION_MODULE_ADDRESS, TREASURY_ROUTER_ADDRESS, AGENT_DEPOSIT_VAULT_ADDRESS"
    );
  }

  const usdcFromEnv = process.env.USDC_ADDRESS;
  const network = await ethers.provider.getNetwork();
  const netName = process.env.HARDHAT_NETWORK ?? network.name;
  const usdc =
    usdcFromEnv ??
    (netName === "base"
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      : (() => {
          throw new Error("USDC_ADDRESS required");
        })());

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Finishing wiring for Base stack…");

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress);
  const reputation = await ethers.getContractAt("ReputationRegistry", reputationAddress);
  const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress);
  const treasury = await ethers.getContractAt("TreasuryRouter", treasuryAddress);
  const agentVault = await ethers.getContractAt("AgentDepositVault", agentVaultAddress);

  if (isZero(await registry.arbitration())) {
    await confirm("TaskRegistry.setArbitration", registry.setArbitration(arbitrationAddress));
  } else {
    console.log("skip TaskRegistry.setArbitration");
  }

  if (isZero(await registry.treasury())) {
    await confirm("TaskRegistry.setTreasury", registry.setTreasury(treasuryAddress));
  } else {
    console.log("skip TaskRegistry.setTreasury");
  }

  if (isZero(String(await registry.agentVault()))) {
    await confirm("TaskRegistry.setAgentVault", registry.setAgentVault(agentVaultAddress));
  } else {
    console.log("skip TaskRegistry.setAgentVault");
  }

  if (isZero(await escrow.arbitrationModule())) {
    await confirm(
      "EscrowVault.setArbitrationModule",
      escrow.setArbitrationModule(arbitrationAddress)
    );
  } else {
    console.log("skip EscrowVault.setArbitrationModule");
  }

  if (isZero(await reputation.taskRegistry())) {
    await confirm(
      "ReputationRegistry.setAuthorized",
      reputation.setAuthorized(registryAddress, arbitrationAddress)
    );
  } else {
    console.log("skip ReputationRegistry.setAuthorized");
  }

  if (isZero(await reputation.agentDepositVault())) {
    await confirm(
      "ReputationRegistry.setAgentDepositVault",
      reputation.setAgentDepositVault(agentVaultAddress)
    );
  } else {
    console.log("skip ReputationRegistry.setAgentDepositVault");
  }

  if (isZero(String(await arbitration.reputationRegistry()))) {
    await confirm(
      "ArbitrationModule.setReputationRegistry",
      arbitration.setReputationRegistry(reputationAddress)
    );
  } else {
    console.log("skip ArbitrationModule.setReputationRegistry");
  }

  if (isZero(String(await arbitration.agentDepositVault()))) {
    await confirm(
      "ArbitrationModule.setAgentDepositVault",
      arbitration.setAgentDepositVault(agentVaultAddress)
    );
  } else {
    console.log("skip ArbitrationModule.setAgentDepositVault");
  }

  if (isZero(await reputation.treasury())) {
    await confirm("ReputationRegistry.setTreasury", reputation.setTreasury(treasuryAddress));
  } else {
    console.log("skip ReputationRegistry.setTreasury");
  }

  if (isZero(await treasury.reputationRegistry())) {
    await confirm(
      "TreasuryRouter.setReputationRegistry",
      treasury.setReputationRegistry(reputationAddress)
    );
  } else {
    console.log("skip TreasuryRouter.setReputationRegistry");
  }

  if (isZero(await treasury.agentDepositVault())) {
    await confirm(
      "TreasuryRouter.setAgentDepositVault",
      treasury.setAgentDepositVault(agentVaultAddress)
    );
  } else {
    console.log("skip TreasuryRouter.setAgentDepositVault");
  }

  if (isZero(await agentVault.taskRegistry())) {
    await confirm(
      "AgentDepositVault.wire",
      agentVault.wire(registryAddress, treasuryAddress, reputationAddress)
    );
  } else {
    console.log("skip AgentDepositVault.wire");
  }

  if (isZero(String(await treasury.azlToken()))) {
    await confirm("TreasuryRouter.setAzlToken", treasury.setAzlToken(azlToken));
  } else {
    console.log("skip TreasuryRouter.setAzlToken");
  }

  const out = {
    chainId: network.chainId.toString(),
    network: netName,
    usdc,
    azlToken,
    feeRecipient,
    deployer: deployer.address,
    EscrowVault: escrowAddress,
    TaskRegistry: registryAddress,
    ReputationRegistry: reputationAddress,
    ArbitrationModule: arbitrationAddress,
    TreasuryRouter: treasuryAddress,
    AgentDepositVault: agentVaultAddress,
  };

  console.log("\n" + JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

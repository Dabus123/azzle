/**
 * Resume mainnet deploy after EscrowVault + TaskRegistry + setTaskRegistry.
 * Set ESCROW_VAULT_ADDRESS and TASK_REGISTRY_ADDRESS in .env (see .env.example).
 */
import { ethers } from "hardhat";
import { confirm } from "./deploy-utils";

const USDC_BY_NETWORK: Record<string, string> = {
  mainnet: "0xA0b86991c6318bA39c0478dD3bD4aA7024928cFc8",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
};

async function main() {
  const network = await ethers.provider.getNetwork();
  const netName = process.env.HARDHAT_NETWORK ?? network.name;
  const usdcFromEnv = process.env.USDC_ADDRESS;
  const usdc =
    usdcFromEnv ??
    USDC_BY_NETWORK[netName] ??
    (() => {
      throw new Error(
        `Set USDC_ADDRESS or use a known network (mainnet/base/arbitrum). Got: ${netName}`
      );
    })();

  const feeRecipient = process.env.FEE_RECIPIENT;
  if (!feeRecipient) {
    throw new Error("FEE_RECIPIENT required");
  }

  const azlToken = process.env.AZL_TOKEN_ADDRESS;
  if (!azlToken) {
    throw new Error("AZL_TOKEN_ADDRESS required");
  }

  const escrowAddress = process.env.ESCROW_VAULT_ADDRESS?.trim();
  const registryAddress = process.env.TASK_REGISTRY_ADDRESS?.trim();
  if (!escrowAddress || !registryAddress) {
    throw new Error(
      "ESCROW_VAULT_ADDRESS and TASK_REGISTRY_ADDRESS required to resume deploy"
    );
  }

  const [deployer] = await ethers.getSigners();
  console.log("Network:", netName, "chainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("Resuming from EscrowVault:", escrowAddress);
  console.log("Resuming from TaskRegistry:", registryAddress);

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress);

  const linkedRegistry = await escrow.taskRegistry();
  if (linkedRegistry.toLowerCase() !== registryAddress.toLowerCase()) {
    throw new Error(
      `EscrowVault.taskRegistry is ${linkedRegistry}, expected ${registryAddress}`
    );
  }

  const reputation = await (await ethers.getContractFactory("ReputationRegistry")).deploy();
  await reputation.waitForDeployment();

  const arbitration = await (
    await ethers.getContractFactory("ArbitrationModule")
  ).deploy(registryAddress, escrowAddress);
  await arbitration.waitForDeployment();

  const treasury = await (
    await ethers.getContractFactory("TreasuryRouter")
  ).deploy(registryAddress, feeRecipient);
  await treasury.waitForDeployment();

  const agentVault = await (
    await ethers.getContractFactory("AgentDepositVault")
  ).deploy(usdc);
  await agentVault.waitForDeployment();

  await confirm("TaskRegistry.setArbitration", registry.setArbitration(await arbitration.getAddress()));
  await confirm("TaskRegistry.setTreasury", registry.setTreasury(await treasury.getAddress()));
  await confirm("TaskRegistry.setAgentVault", registry.setAgentVault(await agentVault.getAddress()));
  await confirm(
    "EscrowVault.setArbitrationModule",
    escrow.setArbitrationModule(await arbitration.getAddress())
  );
  await confirm(
    "ReputationRegistry.setAuthorized",
    reputation.setAuthorized(registryAddress, await arbitration.getAddress())
  );
  await confirm(
    "ReputationRegistry.setAgentDepositVault",
    reputation.setAgentDepositVault(await agentVault.getAddress())
  );
  await confirm(
    "ArbitrationModule.setReputationRegistry",
    arbitration.setReputationRegistry(await reputation.getAddress())
  );
  await confirm(
    "ArbitrationModule.setAgentDepositVault",
    arbitration.setAgentDepositVault(await agentVault.getAddress())
  );
  await confirm("ReputationRegistry.setTreasury", reputation.setTreasury(await treasury.getAddress()));
  await confirm(
    "TreasuryRouter.setReputationRegistry",
    treasury.setReputationRegistry(await reputation.getAddress())
  );
  await confirm(
    "TreasuryRouter.setAgentDepositVault",
    treasury.setAgentDepositVault(await agentVault.getAddress())
  );
  await confirm(
    "AgentDepositVault.wire",
    agentVault.wire(registryAddress, await treasury.getAddress(), await reputation.getAddress())
  );
  await confirm("TreasuryRouter.setAzlToken", treasury.setAzlToken(azlToken));

  const out = {
    chainId: network.chainId.toString(),
    network: netName,
    usdc,
    azlToken,
    feeRecipient,
    deployer: deployer.address,
    EscrowVault: escrowAddress,
    TaskRegistry: registryAddress,
    ReputationRegistry: await reputation.getAddress(),
    ArbitrationModule: await arbitration.getAddress(),
    TreasuryRouter: await treasury.getAddress(),
    AgentDepositVault: await agentVault.getAddress(),
  };

  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Mainnet / L2 deployment — requires env (see contracts/.env.example).
 * Uses real USDC; does not mint test tokens.
 */
import { ethers } from "hardhat";

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
    throw new Error("FEE_RECIPIENT required (treasury withdrawFees recipient)");
  }

  const azlToken = process.env.AZL_TOKEN_ADDRESS;
  if (!azlToken) {
    throw new Error("AZL_TOKEN_ADDRESS required (live AZZLE token on target chain)");
  }

  const [deployer] = await ethers.getSigners();
  console.log("Network:", netName, "chainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("USDC:", usdc);
  console.log("AZZLE:", azlToken);
  console.log("Fee recipient:", feeRecipient);

  const escrow = await (await ethers.getContractFactory("EscrowVault")).deploy();
  await escrow.waitForDeployment();

  const registry = await (
    await ethers.getContractFactory("TaskRegistry")
  ).deploy(await escrow.getAddress());
  await registry.waitForDeployment();

  await escrow.setTaskRegistry(await registry.getAddress());

  const reputation = await (await ethers.getContractFactory("ReputationRegistry")).deploy();
  await reputation.waitForDeployment();

  const arbitration = await (
    await ethers.getContractFactory("ArbitrationModule")
  ).deploy(await registry.getAddress(), await escrow.getAddress());
  await arbitration.waitForDeployment();

  const treasury = await (
    await ethers.getContractFactory("TreasuryRouter")
  ).deploy(await registry.getAddress(), feeRecipient);
  await treasury.waitForDeployment();

  const agentVault = await (
    await ethers.getContractFactory("AgentDepositVault")
  ).deploy(usdc);
  await agentVault.waitForDeployment();

  await registry.setArbitration(await arbitration.getAddress());
  await registry.setTreasury(await treasury.getAddress());
  await registry.setAgentVault(await agentVault.getAddress());
  await escrow.setArbitrationModule(await arbitration.getAddress());
  await reputation.setAuthorized(
    await registry.getAddress(),
    await arbitration.getAddress()
  );
  await reputation.setAgentDepositVault(await agentVault.getAddress());
  await arbitration.setReputationRegistry(await reputation.getAddress());
  await arbitration.setAgentDepositVault(await agentVault.getAddress());
  await reputation.setTreasury(await treasury.getAddress());
  await treasury.setReputationRegistry(await reputation.getAddress());
  await treasury.setAgentDepositVault(await agentVault.getAddress());
  await agentVault.wire(
    await registry.getAddress(),
    await treasury.getAddress(),
    await reputation.getAddress()
  );
  await treasury.setAzlToken(azlToken);

  const out = {
    chainId: network.chainId.toString(),
    network: netName,
    usdc,
    azlToken,
    feeRecipient,
    deployer: deployer.address,
    EscrowVault: await escrow.getAddress(),
    TaskRegistry: await registry.getAddress(),
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

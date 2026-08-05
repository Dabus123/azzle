import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();

  const MockAZL = await ethers.getContractFactory("MockAZL");
  const azl = await MockAZL.deploy();
  await azl.waitForDeployment();

  const EscrowVault = await ethers.getContractFactory("EscrowVault");
  const escrow = await EscrowVault.deploy();
  await escrow.waitForDeployment();

  const TaskRegistry = await ethers.getContractFactory("TaskRegistry");
  const registry = await TaskRegistry.deploy(await escrow.getAddress());
  await registry.waitForDeployment();

  await escrow.setTaskRegistry(await registry.getAddress());

  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputation = await ReputationRegistry.deploy();
  await reputation.waitForDeployment();

  const ArbitrationModule = await ethers.getContractFactory("ArbitrationModule");
  const arbitration = await ArbitrationModule.deploy(
    await registry.getAddress(),
    await escrow.getAddress()
  );
  await arbitration.waitForDeployment();

  const TreasuryRouter = await ethers.getContractFactory("TreasuryRouter");
  const treasury = await TreasuryRouter.deploy(await registry.getAddress(), deployer.address);
  await treasury.waitForDeployment();

  const agentVault = await (
    await ethers.getContractFactory("AgentDepositVault")
  ).deploy(await usdc.getAddress());
  await agentVault.waitForDeployment();

  await registry.setArbitration(await arbitration.getAddress());
  await registry.setTreasury(await treasury.getAddress());
  await registry.setAgentVault(await agentVault.getAddress());
  await escrow.setArbitrationModule(await arbitration.getAddress());
  await reputation.setAuthorized(await registry.getAddress(), await arbitration.getAddress());
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
  await treasury.setAzlToken(await azl.getAddress());

  await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6));

  console.log("MockUSDC:", await usdc.getAddress());
  console.log("MockAZL:", await azl.getAddress());
  console.log("EscrowVault:", await escrow.getAddress());
  console.log("TaskRegistry:", await registry.getAddress());
  console.log("ReputationRegistry:", await reputation.getAddress());
  console.log("ArbitrationModule:", await arbitration.getAddress());
  console.log("TreasuryRouter:", await treasury.getAddress());
  console.log("AgentDepositVault:", await agentVault.getAddress());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

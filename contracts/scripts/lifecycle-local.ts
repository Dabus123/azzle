/**
 * Local Hardhat lifecycle: poster → worker → proof → accept.
 * Run: npx hardhat run scripts/lifecycle-local.ts
 */
import { ethers } from "hardhat";
import { DEFAULT_ACCEPTANCE_HASH, settlementDigest } from "../test/helpers/deploy";

async function main() {
  const [poster, worker] = await ethers.getSigners();
  console.log("=== AZZLE local lifecycle (Hardhat) ===");
  console.log("Poster:", poster.address);
  console.log("Worker:", worker.address);

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const escrow = await (await ethers.getContractFactory("EscrowVault")).deploy();
  const registry = await (
    await ethers.getContractFactory("TaskRegistry")
  ).deploy(await escrow.getAddress());
  await escrow.setTaskRegistry(await registry.getAddress());

  const reputation = await (await ethers.getContractFactory("ReputationRegistry")).deploy();
  const arbitration = await (
    await ethers.getContractFactory("ArbitrationModule")
  ).deploy(await registry.getAddress(), await escrow.getAddress());
  const treasury = await (
    await ethers.getContractFactory("TreasuryRouter")
  ).deploy(await registry.getAddress(), poster.address);

  await registry.setArbitration(await arbitration.getAddress());
  await registry.setTreasury(await treasury.getAddress());
  await escrow.setArbitrationModule(await arbitration.getAddress());
  await reputation.setAuthorized(
    await registry.getAddress(),
    await arbitration.getAddress()
  );
  const agentVault = await (
    await ethers.getContractFactory("AgentDepositVault")
  ).deploy(await usdc.getAddress());

  await registry.setAgentVault(await agentVault.getAddress());
  await arbitration.setReputationRegistry(await reputation.getAddress());
  await arbitration.setAgentDepositVault(await agentVault.getAddress());
  const satellite = await (
    await ethers.getContractFactory("ArbitrationSatellite")
  ).deploy(await arbitration.getAddress(), await reputation.getAddress());
  await arbitration.setArbitrationSatellite(await satellite.getAddress());
  await reputation.setArbitrationSatellite(await satellite.getAddress());
  await reputation.setTreasury(await treasury.getAddress());
  await treasury.setReputationRegistry(await reputation.getAddress());
  await agentVault.wire(
    await registry.getAddress(),
    await treasury.getAddress(),
    await reputation.getAddress()
  );

  const amount = ethers.parseUnits("100", 6);
  const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
  const digest = await settlementDigest({ registry, poster, usdc }, {
    worker: worker.address,
    totalAmount: amount,
    escrowMode: 1,
    deadline,
    milestoneAmounts: [amount],
    acceptanceCriteriaHash: DEFAULT_ACCEPTANCE_HASH,
  });

  console.log("\n--- Deployed ---");
  console.log("MockUSDC:", await usdc.getAddress());
  console.log("EscrowVault:", await escrow.getAddress());
  console.log("TaskRegistry:", await registry.getAddress());
  console.log("ArbitrationModule:", await arbitration.getAddress());
  console.log("ArbitrationSatellite:", await satellite.getAddress());
  console.log("ReputationRegistry:", await reputation.getAddress());
  console.log("TreasuryRouter:", await treasury.getAddress());

  await registry.connect(poster).createTask(
    worker.address,
    await usdc.getAddress(),
    amount,
    1,
    digest,
    deadline,
    true,
    [amount],
    0,
    0,
    DEFAULT_ACCEPTANCE_HASH
  );
  console.log("\n--- Task 1 created ---");

  await usdc.mint(poster.address, amount);
  await usdc.connect(poster).approve(await escrow.getAddress(), amount);
  await registry.connect(poster).fundTask(1, amount);
  console.log("Funded escrow:", ethers.formatUnits(amount, 6), "USDC");

  const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-demo"));
  await registry.connect(worker).submitProof(1, 0, receiptHash);
  console.log("Proof submitted:", receiptHash);

  await registry.connect(poster).acceptMilestone(1, 0);
  const workerBal = await usdc.balanceOf(worker.address);
  console.log("Milestone accepted. Worker balance:", ethers.formatUnits(workerBal, 6), "USDC");
  console.log("\n=== Lifecycle complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

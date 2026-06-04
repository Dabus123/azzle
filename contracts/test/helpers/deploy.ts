import { ethers } from "hardhat";
import type {
  AgentDepositVault,
  ArbitrationModule,
  EscrowVault,
  MockAZL,
  MockUSDC,
  ReputationRegistry,
  TaskRegistry,
  TreasuryRouter,
} from "../../typechain-types";

export const ACCESS_FEE = ethers.parseUnits("5", 6);
export const AZL_ACCESS_FEE = ethers.parseUnits("1000", 18);
export const MIN_ENTRY = ethers.parseUnits("20", 6);
export const MIN_TASK = ethers.parseUnits("8", 6);
/** @deprecated use MIN_ENTRY */
export const MIN_BALANCE = MIN_ENTRY;
export const MIN_PLUS_FEE = MIN_ENTRY + ACCESS_FEE;

export interface AzzleFixture {
  poster: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  worker: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  arbitrator: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  usdc: MockUSDC;
  azl: MockAZL;
  escrow: EscrowVault;
  registry: TaskRegistry;
  arbitration: ArbitrationModule;
  reputation: ReputationRegistry;
  treasury: TreasuryRouter;
  agentVault: AgentDepositVault;
}

export async function deployAzzleStack(): Promise<AzzleFixture> {
  const [poster, worker, arbitrator] = await ethers.getSigners();

  const usdc = await (await ethers.getContractFactory("MockUSDC")).deploy();
  const azl = await (await ethers.getContractFactory("MockAZL")).deploy();
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

  const agentVault = await (
    await ethers.getContractFactory("AgentDepositVaultHarness")
  ).deploy(await usdc.getAddress());

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
  await treasury.setAzlToken(await azl.getAddress());

  return {
    poster,
    worker,
    arbitrator,
    usdc,
    azl,
    escrow,
    registry,
    arbitration,
    reputation,
    treasury,
    agentVault,
  };
}

export async function topUpAgent(
  fx: AzzleFixture,
  user: Awaited<ReturnType<typeof ethers.getSigners>>[0],
  amount: bigint = ethers.parseUnits("100", 6)
) {
  await fx.usdc.mint(user.address, amount);
  await fx.usdc.connect(user).approve(await fx.agentVault.getAddress(), amount);
  await fx.agentVault.connect(user).topUp(amount);
}

export async function fundAzlForAgent(
  fx: AzzleFixture,
  user: Awaited<ReturnType<typeof ethers.getSigners>>[0],
  amount: bigint = ethers.parseUnits("10000", 18)
) {
  await fx.azl.mint(user.address, amount);
  await fx.azl
    .connect(user)
    .approve(await fx.treasury.getAddress(), ethers.MaxUint256);
}

export async function createFundedMilestoneTask(
  fx: AzzleFixture,
  opts?: { deadlineOffset?: number; replacementAllowed?: boolean }
) {
  const amount = ethers.parseUnits("100", 6);
  const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
  const { time } = await import("@nomicfoundation/hardhat-network-helpers");
  const deadline = (await time.latest()) + (opts?.deadlineOffset ?? 86400);

  await topUpAgent(fx, fx.poster);
  await topUpAgent(fx, fx.worker);

  await fx.registry.connect(fx.poster).createTask(
    fx.worker.address,
    await fx.usdc.getAddress(),
    amount,
    1,
    digest,
    deadline,
    opts?.replacementAllowed ?? true,
    [amount],
    0,
    0
  );

  await fx.usdc.mint(fx.poster.address, amount);
  await fx.usdc.connect(fx.poster).approve(await fx.escrow.getAddress(), amount);
  await fx.registry.connect(fx.poster).fundTask(1, amount);

  return { amount, digest, deadline };
}

/** Search-market path: POSTED → arbitrator standby → CLAIMED → ACTIVE → dispute */
export async function createPostedFundedTask(fx: AzzleFixture) {
  const amount = ethers.parseUnits("0.5", 6); // tier 0 dispute (< $1)
  const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
  const { time } = await import("@nomicfoundation/hardhat-network-helpers");
  const deadline = (await time.latest()) + 86400;

  await topUpAgent(fx, fx.poster);
  await topUpAgent(fx, fx.worker);
  await topUpAgent(fx, fx.arbitrator);
  await fundAzlForAgent(fx, fx.poster);
  await fundAzlForAgent(fx, fx.worker);

  await fx.registry.connect(fx.poster).postTask(
    await fx.usdc.getAddress(),
    amount,
    1,
    digest,
    deadline,
    [amount],
    0,
    0
  );

  await fx.arbitration.connect(fx.arbitrator).registerArbitrator(1);

  await fx.registry.connect(fx.worker).claimTask(1);

  await fx.usdc.mint(fx.poster.address, amount);
  await fx.usdc.connect(fx.poster).approve(await fx.escrow.getAddress(), amount);
  await fx.registry.connect(fx.poster).fundTask(1, amount);
  await fx.registry.connect(fx.poster).startWork(1);

  return { amount, digest, deadline };
}

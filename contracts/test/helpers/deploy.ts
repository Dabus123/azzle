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
  UnionStakingVault,
} from "../../typechain-types";

export const ACCESS_FEE = ethers.parseUnits("5", 6);
export const AZL_ACCESS_FEE = ethers.parseUnits("1000", 18);
export const MIN_ENTRY = ethers.parseUnits("25", 6);
export const MIN_TASK = ethers.parseUnits("8", 6);
/** @deprecated use MIN_ENTRY */
export const MIN_BALANCE = MIN_ENTRY;
export const MIN_PLUS_FEE = MIN_ENTRY + ACCESS_FEE;
export const DEFAULT_ACCEPTANCE_HASH = ethers.id("azzle-test-acceptance");

export interface SettlementTerms {
  poster?: string;
  worker?: string;
  token?: string;
  totalAmount: bigint;
  escrowMode: number;
  deadline: number;
  milestoneAmounts?: bigint[];
  streamRate?: bigint;
  hourBlockSize?: bigint;
  acceptanceCriteriaHash?: string;
}
/** Canonical SDK-compatible settlement digest v2 fixture. */
export async function settlementDigest(
  fx: Pick<AzzleFixture, "registry" | "poster" | "usdc">,
  params: SettlementTerms
) {
  const milestonesHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256[]"],
      [params.milestoneAmounts ?? []]
    )
  );
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "bytes32", "uint256", "address", "address", "address", "address",
        "uint256", "uint8", "bytes32", "uint256", "uint256", "uint256",
        "bytes32",
      ],
      [
        ethers.id("azzle-task-settlement-v2"),
        (await ethers.provider.getNetwork()).chainId,
        await fx.registry.getAddress(),
        params.poster ?? fx.poster.address,
        params.worker ?? ethers.ZeroAddress,
        params.token ?? await fx.usdc.getAddress(),
        params.totalAmount,
        params.escrowMode,
        milestonesHash,
        params.streamRate ?? 0n,
        params.hourBlockSize ?? 0n,
        params.deadline,
        params.acceptanceCriteriaHash ?? DEFAULT_ACCEPTANCE_HASH,
      ]
    )
  );
}

export async function postTaskArgs(fx: AzzleFixture, params: SettlementTerms) {
  const acceptanceCriteriaHash =
    params.acceptanceCriteriaHash ?? DEFAULT_ACCEPTANCE_HASH;
  const digest = await settlementDigest(fx, {
    ...params,
    worker: ethers.ZeroAddress,
    acceptanceCriteriaHash,
  });
  return [
    params.token ?? await fx.usdc.getAddress(),
    params.totalAmount,
    params.escrowMode,
    digest,
    params.deadline,
    params.milestoneAmounts ?? [],
    params.streamRate ?? 0n,
    params.hourBlockSize ?? 0n,
    acceptanceCriteriaHash,
  ] as const;
}

export async function createTaskArgs(
  fx: AzzleFixture,
  params: SettlementTerms & { worker: string }
) {
  const acceptanceCriteriaHash =
    params.acceptanceCriteriaHash ?? DEFAULT_ACCEPTANCE_HASH;
  const digest = await settlementDigest(fx, {
    ...params,
    acceptanceCriteriaHash,
  });
  return [
    params.worker,
    params.token ?? await fx.usdc.getAddress(),
    params.totalAmount,
    params.escrowMode,
    digest,
    params.deadline,
    params.milestoneAmounts ?? [],
    params.streamRate ?? 0n,
    params.hourBlockSize ?? 0n,
    acceptanceCriteriaHash,
  ] as const;
}

export interface AzzleFixture {
  poster: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  worker: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  arbitrator: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  buyback: Awaited<ReturnType<typeof ethers.getSigners>>[0];
  usdc: MockUSDC;
  azl: MockAZL;
  escrow: EscrowVault;
  registry: TaskRegistry;
  arbitration: ArbitrationModule;
  reputation: ReputationRegistry;
  treasury: TreasuryRouter;
  agentVault: AgentDepositVault;
  staking: UnionStakingVault;
}

export async function deployAzzleStack(): Promise<AzzleFixture> {
  const [poster, worker, arbitrator, buyback] = await ethers.getSigners();

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
  await registry.setReputation(await reputation.getAddress());
  await agentVault.setArbitrationModule(await arbitration.getAddress());
  await escrow.setArbitrationModule(await arbitration.getAddress());
  await reputation.setAuthorized(
    await registry.getAddress(),
    await arbitration.getAddress()
  );
  await reputation.connect(arbitrator).stakeVerifierBond({ value: ethers.parseEther("1") });
  await reputation.setAgentDepositVault(await agentVault.getAddress());
  await arbitration.setReputationRegistry(await reputation.getAddress());
  await arbitration.setAgentDepositVault(await agentVault.getAddress());
  await arbitration.setFallbackResolver(arbitrator.address);
  const satellite = await (
    await ethers.getContractFactory("ArbitrationSatellite")
  ).deploy(await arbitration.getAddress(), await reputation.getAddress());
  await arbitration.setArbitrationSatellite(await satellite.getAddress());
  await reputation.setArbitrationSatellite(await satellite.getAddress());
  await reputation.setTreasury(await treasury.getAddress());
  await treasury.setReputationRegistry(await reputation.getAddress());
  await treasury.setAgentDepositVault(await agentVault.getAddress());
  await agentVault.wire(
    await registry.getAddress(),
    await treasury.getAddress(),
    await reputation.getAddress()
  );
  await treasury.setAzlToken(await azl.getAddress());

  const recovery = await (
    await ethers.getContractFactory("ArbitrationRecoveryCoordinator")
  ).deploy(
    await registry.getAddress(),
    await escrow.getAddress(),
    await agentVault.getAddress(),
    await reputation.getAddress()
  );
  await registry.setArbitrationRecoveryCoordinator(await recovery.getAddress());
  await arbitration.setArbitrationRecoveryCoordinator(await recovery.getAddress());
  await escrow.setArbitrationRecoveryCoordinator(await recovery.getAddress());
  await agentVault.setArbitrationRecoveryCoordinator(await recovery.getAddress());
  await reputation.setArbitrationRecoveryCoordinator(await recovery.getAddress());

  const staking = await (
    await ethers.getContractFactory("UnionStakingVault")
  ).deploy(await azl.getAddress(), await usdc.getAddress());
  await staking.setTaskRegistry(await registry.getAddress());
  await staking.setTreasury(await treasury.getAddress());
  await staking.activateStaking();
  await registry.setStakingVault(await staking.getAddress());
  await treasury.setStakingVault(await staking.getAddress());
  await treasury.setBuybackExecutor(buyback.address);

  return {
    poster,
    worker,
    arbitrator,
    buyback,
    usdc,
    azl,
    escrow,
    registry,
    arbitration,
    reputation,
    treasury,
    agentVault,
    staking,
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
  opts?: { deadlineOffset?: number }
) {
  const amount = ethers.parseUnits("100", 6);
  const { time } = await import("@nomicfoundation/hardhat-network-helpers");
  const deadline = (await time.latest()) + Math.min(opts?.deadlineOffset ?? 86400, 30 * 86400);
  const acceptanceCriteriaHash = DEFAULT_ACCEPTANCE_HASH;
  const digest = await settlementDigest(fx, {
    worker: fx.worker.address,
    totalAmount: amount,
    escrowMode: 1,
    deadline,
    milestoneAmounts: [amount],
    acceptanceCriteriaHash,
  });

  await topUpAgent(fx, fx.poster);
  await topUpAgent(fx, fx.worker, MIN_PLUS_FEE);
  await fundAzlForAgent(fx, fx.poster);

  await fx.registry.connect(fx.poster).createTask(
    fx.worker.address,
    await fx.usdc.getAddress(),
    amount,
    1,
    digest,
    deadline,
    [amount],
    0,
    0,
    acceptanceCriteriaHash
  );
  await fx.registry.connect(fx.worker).acceptDirectHire(1);

  await fx.usdc.mint(fx.poster.address, amount);
  await fx.usdc.connect(fx.poster).approve(await fx.escrow.getAddress(), amount);
  await fx.registry.connect(fx.poster).fundTask(1, amount);

  return { amount, digest, deadline };
}

/** Wire a codehash-approved replacement module for recovery execution. */
export async function wireRecoveryReplacement(
  fx: AzzleFixture,
  replacement: {
    getAddress: () => Promise<string>;
    setReputationRegistry: (addr: string) => Promise<unknown>;
    setAgentDepositVault: (addr: string) => Promise<unknown>;
    setArbitrationRecoveryCoordinator: (addr: string) => Promise<unknown>;
    setFallbackResolver: (addr: string) => Promise<unknown>;
    setDisputeOpeningPaused: (paused: boolean) => Promise<unknown>;
    setArbitrationSatellite: (addr: string) => Promise<unknown>;
  }
) {
  await replacement.setReputationRegistry(await fx.reputation.getAddress());
  await replacement.setAgentDepositVault(await fx.agentVault.getAddress());
  await replacement.setArbitrationRecoveryCoordinator(
    await fx.registry.arbitrationRecoveryCoordinator()
  );
  await replacement.setFallbackResolver(fx.arbitrator.address);
  await replacement.setDisputeOpeningPaused(true);
  const satellite = await (
    await ethers.getContractFactory("ArbitrationSatellite")
  ).deploy(await replacement.getAddress(), await fx.reputation.getAddress());
  await replacement.setArbitrationSatellite(await satellite.getAddress());
  return satellite;
}

/** Mutual party consent plus arbitrator acceptance seats an arbitrator. */
export async function seatMutualArbitrator(
  fx: AzzleFixture,
  disputeId: bigint | number,
  arbitrator = fx.arbitrator
) {
  await fx.arbitration.connect(fx.poster).proposeArbitrator(disputeId, arbitrator.address);
  await fx.arbitration.connect(fx.worker).proposeArbitrator(disputeId, arbitrator.address);
  await fx.arbitration.connect(arbitrator).acceptArbitratorSeat(disputeId);
}

/** Search-market path: POSTED → arbitrator standby → CLAIMED → ACTIVE → dispute */
export async function createPostedFundedTask(fx: AzzleFixture) {
  const amount = ethers.parseUnits("0.5", 6); // tier 0 dispute (< $1)
  const { time } = await import("@nomicfoundation/hardhat-network-helpers");
  const deadline = (await time.latest()) + 86400;
  const acceptanceCriteriaHash = DEFAULT_ACCEPTANCE_HASH;
  const digest = await settlementDigest(fx, {
    totalAmount: amount,
    escrowMode: 1,
    deadline,
    milestoneAmounts: [amount],
    acceptanceCriteriaHash,
  });

  await topUpAgent(fx, fx.poster);
  await topUpAgent(fx, fx.worker);
  await topUpAgent(fx, fx.arbitrator);
  await fundAzlForAgent(fx, fx.poster);
  await fundAzlForAgent(fx, fx.worker);

  await fx.arbitration.connect(fx.arbitrator).registerArbitratorGlobal();
  await fx.arbitration.qualifyBootstrapArbitrator(fx.arbitrator.address);

  await fx.registry.connect(fx.poster).postTask(
    await fx.usdc.getAddress(),
    amount,
    1,
    digest,
    deadline,
    [amount],
    0,
    0,
    acceptanceCriteriaHash
  );

  await fx.registry.connect(fx.worker).claimTask(1);

  await fx.usdc.mint(fx.poster.address, amount);
  await fx.usdc.connect(fx.poster).approve(await fx.escrow.getAddress(), amount);
  await fx.registry.connect(fx.poster).fundTask(1, amount);
  await fx.registry.connect(fx.poster).startWork(1);

  return { amount, digest, deadline };
}

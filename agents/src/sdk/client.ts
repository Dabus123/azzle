import { ethers, Contract } from "ethers";
import type { AzzleClientConfig, TaskTerms } from "./types.js";
import { buildSettlementDigest } from "./settlement.js";
import { BASE_MAINNET_MANIFEST } from "./manifest.js";

const REGISTRY_ABI = [
  "function post(uint256 totalAmount, uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)",
  "function activate(uint256 taskId)",
  "function fund(uint256 taskId, uint256 amount)",
  "function markDelivered(uint256 taskId)",
  "function release(uint256 taskId, uint256 amount)",
  "function complete(uint256 taskId)",
  "function cancel(uint256 taskId)",
  "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId, bytes32 evidenceHash)",
  "function maxWithdrawableDeposit(address agent) view returns (uint256)",
  "function taskCount() view returns (uint256)",
  "function taskState(uint256 taskId) view returns (uint8)",
  "function tasks(uint256 taskId) view returns (tuple(address poster, address worker, uint256 totalAmount, uint256 funded, uint256 released, uint64 deadline, uint64 fundingDeadline, uint64 deliveredAt, uint8 state))",
];

const ESCROW_READ_ABI = [
  "function lockedBalance(uint256 taskId) view returns (uint256)",
];

const TASK_SCOPE_ABI = [
  "function scopeOf(uint256 taskId) view returns (string)",
];

/** TaskState enum names, indexed by the on-chain uint8 value. */
export const TASK_STATE_NAMES = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
] as const;

export interface OnChainTask {
  poster: string;
  worker: string;
  totalAmount: bigint;
  funded: bigint;
  released: bigint;
  state: number;
  stateName: string;
  deadline: bigint;
  fundingDeadline: bigint;
  deliveredAt: bigint;
}

const VAULT_ABI = [
  "function topUp(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function withdrawTo(address to, uint256 amount)",
  "function claimPayout(address to)",
  "function balanceOf(address agent) view returns (uint256)",
];

const STAKING_ABI = [
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claimUnstake(address recipient)",
  "function bankCredits()",
  "function claimRewards()",
  "function claimRewardsTo(address recipient)",
  "function stakingActive() view returns (bool)",
  "function creditsOf(address) view returns (uint256)",
  "function creditsRemaining() view returns (uint256)",
  "function claimableUsdc(address) view returns (uint256)",
  "function stakers(address) view returns (uint256 staked,uint256 pendingUnstake,uint256 bankedCredits,uint256 creditDebt,uint256 creditRemainderScaled,uint256 pendingUsdc,uint256 usdcDebt,uint256 usdcRemainderScaled)",
];

const ARBITRATION_ABI = [
  "function registerArbitrator(uint256 taskId)",
  "function registerArbitratorGlobal()",
  "function proposeArbitrator(uint256 disputeId, address arbitrator)",
  "function resolveDispute(uint256 disputeId, uint256 workerBps)",
  "function resolveTimedOut(uint256 disputeId)",
  "function assignFallbackResolver(uint256 disputeId)",
  "function retrySideEffects(uint256 disputeId)",
  "function escalate(uint256 disputeId)",
  "function disputeCount() view returns (uint256)",
];

const TASK_POSTED_IFACE = new ethers.Interface([
  "event TaskPosted(uint256 indexed taskId, address indexed poster, uint256 totalAmount, uint256 amountUsd6, uint64 deadline)",
]);

function taskIdFromReceipt(
  receipt: ethers.ContractTransactionReceipt,
  registryAddress: string
): bigint {
  const addr = registryAddress.toLowerCase();
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== addr) continue;
    try {
      const parsed = TASK_POSTED_IFACE.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed && (parsed.name === "TaskPosted" || parsed.name === "TaskCreated")) {
        return parsed.args.taskId as bigint;
      }
    } catch {
      /* not this event */
    }
  }
  throw new Error("AzzleClient: TaskPosted/TaskCreated event not found in receipt");
}

export class AzzleClient {
  private provider: ethers.JsonRpcProvider;
  private registry: Contract;
  private escrowReader: Contract;
  private taskScope?: Contract;
  private arbitration?: Contract;
  private vault?: Contract;
  private staking?: Contract;

  constructor(private config: AzzleClientConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    this.escrowReader = new Contract(config.escrowAddress, ESCROW_READ_ABI, this.provider);
    const scopeAddress =
      config.taskScopeAddress ?? BASE_MAINNET_MANIFEST.taskScopeRegistry;
    if (scopeAddress) {
      this.taskScope = new Contract(scopeAddress, TASK_SCOPE_ABI, this.provider);
    }
    if (config.arbitrationAddress) {
      this.arbitration = new Contract(config.arbitrationAddress, ARBITRATION_ABI, this.provider);
    }
    if (config.agentVaultAddress) {
      this.vault = new Contract(config.agentVaultAddress, VAULT_ABI, this.provider);
    }
    const stakingAddress = config.stakingVaultAddress ?? BASE_MAINNET_MANIFEST.stakingVault;
    if (stakingAddress) this.staking = new Contract(stakingAddress, STAKING_ABI, this.provider);
  }

  connect(signer: ethers.Signer) {
    this.registry = this.registry.connect(signer) as Contract;
    if (this.arbitration) {
      this.arbitration = this.arbitration.connect(signer) as Contract;
    }
    if (this.vault) {
      this.vault = this.vault.connect(signer) as Contract;
    }
    if (this.staking) this.staking = this.staking.connect(signer) as Contract;
    return this;
  }

  private requireVault(): Contract {
    if (!this.vault) {
      throw new Error("AzzleClient: agentVaultAddress required for vault methods");
    }
    return this.vault;
  }

  private requireStaking(): Contract {
    if (!this.staking) throw new Error("AzzleClient: stakingVaultAddress required for staking methods");
    return this.staking;
  }

  async stakingStatus(agent: string) {
    const staking = this.requireStaking();
    const [active, credits, remaining, claimableUsdc, position] = await Promise.all([
      staking.stakingActive(), staking.creditsOf(agent), staking.creditsRemaining(),
      staking.claimableUsdc(agent), staking.stakers(agent),
    ]);
    return { active, credits, wholeCredits: credits / 10n ** 18n, creditsRemaining: remaining, claimableUsdc, staked: position.staked, pendingUnstake: position.pendingUnstake };
  }

  stake(amount: bigint) { return this.requireStaking().stake(amount); }
  unstake(amount: bigint) { return this.requireStaking().unstake(amount); }
  claimUnstake(recipient: string) { return this.requireStaking().claimUnstake(recipient); }
  bankCredits() { return this.requireStaking().bankCredits(); }
  claimRewards() { return this.requireStaking().claimRewards(); }
  claimRewardsTo(recipient: string) { return this.requireStaking().claimRewardsTo(recipient); }

  buildDigest(terms: TaskTerms): string {
    return buildSettlementDigest(terms);
  }

  async createTask(
    terms: Omit<TaskTerms, "chainId" | "registryAddress"> & {
      chainId?: bigint;
      registryAddress?: string;
    }
  ) {
    const committedTerms: TaskTerms = {
      ...terms,
      chainId: terms.chainId ?? this.config.chainId ?? 8453n,
      registryAddress: terms.registryAddress ?? this.config.registryAddress,
    };
    const digest = buildSettlementDigest(committedTerms);
    if (terms.worker && terms.worker !== ethers.ZeroAddress) {
      throw new Error("AzzleClient: V2 TaskRegistryV2 supports public posts only");
    }
    const tx = await this.registry.post(terms.totalAmount, terms.deadline);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleClient: createTask tx failed");
    const taskId = taskIdFromReceipt(receipt, this.config.registryAddress);
    return { taskId, digest, receipt };
  }

  /** Search market: list open work (requires AgentDepositVault + AZZLE approvals). */
  async postTask(
    terms: Omit<TaskTerms, "worker" | "chainId" | "registryAddress"> & {
      worker?: string;
      chainId?: bigint;
      registryAddress?: string;
    }
  ) {
    const digest = buildSettlementDigest({
      ...terms,
      worker: terms.worker ?? ethers.ZeroAddress,
      chainId: terms.chainId ?? this.config.chainId ?? 8453n,
      registryAddress: terms.registryAddress ?? this.config.registryAddress,
    });
    const tx = await this.registry.post(terms.totalAmount, terms.deadline);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleClient: postTask tx failed");
    const taskId = taskIdFromReceipt(receipt, this.config.registryAddress);
    return { taskId, digest, receipt };
  }

  async claimTask(taskId: bigint) {
    return this.registry.claim(taskId);
  }

  async startWork(taskId: bigint) {
    return this.registry.activate(taskId);
  }

  /** Accept a direct-hire invitation. Only the invited worker can activate it. */
  async acceptDirectHire(_taskId: bigint) {
    throw new Error("AzzleClient: direct-hire compatibility is not part of V2");
  }

  /** Decline a direct-hire invitation, terminating it as EXPIRED. */
  async declineDirectHire(_taskId: bigint) {
    throw new Error("AzzleClient: direct-hire compatibility is not part of V2");
  }

  async dismissWorker(taskId: bigint) {
    return this.registry.cancel(taskId);
  }

  async leaveTask(taskId: bigint) {
    return this.registry.cancel(taskId);
  }

  async completeTask(taskId: bigint) {
    return this.registry.complete(taskId);
  }

  async release(taskId: bigint, amount: bigint) {
    return this.registry.release(taskId, amount);
  }

  /** Credit USDC deposit ledger (requires prior usdc.approve(agentVault, amount)). */
  async topUp(amount: bigint) {
    return this.requireVault().topUp(amount);
  }

  async withdrawFromVault(amount: bigint) {
    return this.requireVault().withdraw(amount);
  }

  async withdrawFromVaultTo(recipient: string, amount: bigint) {
    return this.requireVault().withdrawTo(recipient, amount);
  }

  async claimVaultPayout(recipient: string) {
    return this.requireVault().claimPayout(recipient);
  }

  async vaultBalanceOf(agent: string) {
    return this.requireVault().balanceOf(agent) as Promise<bigint>;
  }

  async maxWithdrawableDeposit(agent: string) {
    return this.registry.maxWithdrawableDeposit(agent) as Promise<bigint>;
  }

  /** Raw on-chain TaskState enum value (see TASK_STATE_NAMES). */
  async taskState(taskId: bigint): Promise<number> {
    return Number(await this.registry.taskState(taskId));
  }

  /** Full on-chain V2 task struct via TaskRegistryV2.tasks. */
  async getTask(taskId: bigint): Promise<OnChainTask> {
    const row = await this.registry.tasks(taskId);
    const state = Number(row.state);
    return {
      poster: row.poster as string,
      worker: row.worker as string,
      totalAmount: row.totalAmount as bigint,
      funded: row.funded as bigint,
      released: row.released as bigint,
      state,
      stateName: TASK_STATE_NAMES[state] ?? `UNKNOWN(${state})`,
      deadline: row.deadline as bigint,
      fundingDeadline: row.fundingDeadline as bigint,
      deliveredAt: row.deliveredAt as bigint,
    };
  }

  /** Whether the worker already submitted a proof for the milestone. */
  /** Funded USDC currently held in EscrowVault; cumulative funding is capped by Task.totalAmount. */
  async lockedBalance(taskId: bigint): Promise<bigint> {
    return this.escrowReader.lockedBalance(taskId) as Promise<bigint>;
  }

  /**
   * Published scope text from TaskScopeRegistry.scopeOf(taskId).
   * Returns null when the listing is private (empty scope) or no registry is configured.
   */
  async getTaskScope(taskId: bigint): Promise<string | null> {
    if (!this.taskScope) return null;
    try {
      const scope = (await this.taskScope.scopeOf(taskId)) as string;
      const text = String(scope ?? "").trim();
      return text || null;
    } catch {
      return null;
    }
  }

  async fundTask(taskId: bigint, amount: bigint) {
    return this.registry.fundTask(taskId, amount);
  }

  /** Permissionless terminal settlement after the committed deadline. */
  async expireTask(taskId: bigint) {
    return this.registry.expire(taskId);
  }

  async submitProof(taskId: bigint, milestoneIndex: number, _receiptHash: string) {
    if (milestoneIndex !== 0) throw new Error("AzzleClient: V2 tasks do not use milestone proofs");
    return this.registry.markDelivered(taskId);
  }

  async acceptMilestone(taskId: bigint, milestoneIndex: number) {
    if (milestoneIndex !== 0) throw new Error("AzzleClient: V2 tasks do not use milestone acceptance");
    return this.registry.release(taskId, 0);
  }

  async claimStream(taskId: bigint, maxAmount: bigint) {
    return this.registry.release(taskId, maxAmount);
  }

  async claimHourBlock(taskId: bigint) {
    return this.registry.release(taskId, 0);
  }

  /** Permissionless release of proven milestones after the review timeout. */
  async resolveStaleReview(taskId: bigint) {
    return this.registry.expire(taskId);
  }

  async openDispute(taskId: bigint, evidence: Uint8Array | string) {
    return this.registry.openDispute(taskId, evidence);
  }

  /** Standby registration while task is POSTED or CLAIMED (+10 arbitratorReputation). */
  async registerArbitrator(taskId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for registerArbitrator");
    }
    return this.arbitration.registerArbitrator(taskId);
  }

  /** Join the global standby pool (requires the live vault entry minimum). */
  async registerArbitratorGlobal() {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for registerArbitratorGlobal");
    }
    return this.arbitration.registerArbitratorGlobal();
  }

  /** Both parties must call with the same arbitrator address (mutual consent). */
  async proposeArbitrator(disputeId: bigint, arbitrator: string) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for proposeArbitrator");
    }
    return this.arbitration.proposeArbitrator(disputeId, arbitrator);
  }

  async resolveDispute(disputeId: bigint, workerBps: number) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for resolveDispute");
    }
    return this.arbitration.resolveDispute(disputeId, workerBps);
  }

  async resolveTimedOut(disputeId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for resolveTimedOut");
    }
    return this.arbitration.resolveTimedOut(disputeId);
  }

  /** Permissionlessly seat the dispute's snapshotted fallback after selection timeout. */
  async assignFallbackResolver(disputeId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for assignFallbackResolver");
    }
    return this.arbitration.assignFallbackResolver(disputeId);
  }

  /** Retry deferred bond, reputation, and registry settlement side effects. */
  async retryDisputeSideEffects(disputeId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for retryDisputeSideEffects");
    }
    return this.arbitration.retrySideEffects(disputeId);
  }

  /** Party-only; tier += 1 up to MAX_TIERS (3) while dispute is OPEN. */
  async escalate(disputeId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for escalate");
    }
    return this.arbitration.escalate(disputeId);
  }
}

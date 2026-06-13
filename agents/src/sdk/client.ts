import { ethers, Contract } from "ethers";
import type { AzzleClientConfig, TaskTerms } from "./types.js";
import { buildSettlementDigest } from "./settlement.js";

const REGISTRY_ABI = [
  "function createTask(address worker, address token, uint256 totalAmount, uint8 escrowMode, bytes32 settlementDigest, uint256 deadline, bool replacementAllowed, uint256[] milestoneAmounts, uint256 streamRate, uint256 hourBlockSize) returns (uint256)",
  "function postTask(address token, uint256 totalAmount, uint8 escrowMode, bytes32 settlementDigest, uint256 deadline, uint256[] milestoneAmounts, uint256 streamRate, uint256 hourBlockSize) returns (uint256)",
  "function claimTask(uint256 taskId)",
  "function startWork(uint256 taskId)",
  "function dismissWorker(uint256 taskId)",
  "function leaveTask(uint256 taskId)",
  "function fundTask(uint256 taskId, uint256 amount)",
  "function submitProof(uint256 taskId, uint256 milestoneIndex, bytes32 receiptHash)",
  "function acceptMilestone(uint256 taskId, uint256 milestoneIndex)",
  "function openDispute(uint256 taskId, bytes evidenceHash)",
  "function completeTask(uint256 taskId)",
  "function emergencyTopUp(uint256 taskId, uint256 amount)",
  "function checkTaskBalance(uint256 taskId)",
  "function maxWithdrawableDeposit(address agent) view returns (uint256)",
  "function taskCount() view returns (uint256)",
  "function taskState(uint256 taskId) view returns (uint8)",
];

const VAULT_ABI = [
  "function topUp(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function balanceOf(address agent) view returns (uint256)",
  "function emergencyTopUpRequired(address agent) view returns (uint256)",
  "function blockedUntil(address agent) view returns (uint256)",
];

const ARBITRATION_ABI = [
  "function registerArbitrator(uint256 taskId)",
  "function proposeArbitrator(uint256 disputeId, address arbitrator)",
  "function resolveDispute(uint256 disputeId, uint256 workerBps)",
  "function resolveTimedOut(uint256 disputeId)",
  "function escalate(uint256 disputeId)",
  "function disputeCount() view returns (uint256)",
];

const ESCROW_MODE: Record<string, number> = {
  upfront: 0,
  milestone: 1,
  streaming: 2,
  hour_blocks: 3,
};

const TASK_POSTED_IFACE = new ethers.Interface([
  "event TaskPosted(uint256 indexed taskId, address indexed poster, bytes32 settlementDigest)",
  "event TaskCreated(uint256 indexed taskId, address indexed poster, address indexed worker, bytes32 settlementDigest)",
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
  private arbitration?: Contract;
  private vault?: Contract;

  constructor(private config: AzzleClientConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.registry = new Contract(config.registryAddress, REGISTRY_ABI, this.provider);
    if (config.arbitrationAddress) {
      this.arbitration = new Contract(config.arbitrationAddress, ARBITRATION_ABI, this.provider);
    }
    if (config.agentVaultAddress) {
      this.vault = new Contract(config.agentVaultAddress, VAULT_ABI, this.provider);
    }
  }

  connect(signer: ethers.Signer) {
    this.registry = this.registry.connect(signer) as Contract;
    if (this.arbitration) {
      this.arbitration = this.arbitration.connect(signer) as Contract;
    }
    if (this.vault) {
      this.vault = this.vault.connect(signer) as Contract;
    }
    return this;
  }

  private requireVault(): Contract {
    if (!this.vault) {
      throw new Error("AzzleClient: agentVaultAddress required for vault methods");
    }
    return this.vault;
  }

  buildDigest(terms: TaskTerms): string {
    return buildSettlementDigest(terms);
  }

  private escrowModeValue(mode: TaskTerms["escrowMode"]): number {
    return ESCROW_MODE[mode] ?? 1;
  }

  async createTask(terms: TaskTerms & { milestoneAmounts?: bigint[] }) {
    const digest = buildSettlementDigest(terms);
    const tx = await this.registry.createTask(
      terms.worker,
      terms.token,
      terms.totalAmount,
      this.escrowModeValue(terms.escrowMode),
      digest,
      terms.deadline,
      terms.replacementAllowed,
      terms.milestoneAmounts ?? [terms.totalAmount],
      0,
      0
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleClient: createTask tx failed");
    const taskId = taskIdFromReceipt(receipt, this.config.registryAddress);
    return { taskId, digest, receipt };
  }

  /** Search market: list open work (requires AgentDepositVault + AZZLE approvals). */
  async postTask(
    terms: Omit<TaskTerms, "worker"> & { milestoneAmounts?: bigint[]; worker?: string }
  ) {
    const digest = buildSettlementDigest({
      ...terms,
      worker: terms.worker ?? ethers.ZeroAddress,
    });
    const tx = await this.registry.postTask(
      terms.token,
      terms.totalAmount,
      this.escrowModeValue(terms.escrowMode),
      digest,
      terms.deadline,
      terms.milestoneAmounts ?? [terms.totalAmount],
      0,
      0
    );
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleClient: postTask tx failed");
    const taskId = taskIdFromReceipt(receipt, this.config.registryAddress);
    return { taskId, digest, receipt };
  }

  async claimTask(taskId: bigint) {
    return this.registry.claimTask(taskId);
  }

  async startWork(taskId: bigint) {
    return this.registry.startWork(taskId);
  }

  async dismissWorker(taskId: bigint) {
    return this.registry.dismissWorker(taskId);
  }

  async leaveTask(taskId: bigint) {
    return this.registry.leaveTask(taskId);
  }

  async completeTask(taskId: bigint) {
    return this.registry.completeTask(taskId);
  }

  /** Credit USDC deposit ledger (requires prior usdc.approve(agentVault, amount)). */
  async topUp(amount: bigint) {
    return this.requireVault().topUp(amount);
  }

  async withdrawFromVault(amount: bigint) {
    return this.requireVault().withdraw(amount);
  }

  async vaultBalanceOf(agent: string) {
    return this.requireVault().balanceOf(agent) as Promise<bigint>;
  }

  async emergencyTopUpRequired(agent: string) {
    return this.requireVault().emergencyTopUpRequired(agent) as Promise<bigint>;
  }

  async vaultBlockedUntil(agent: string) {
    return this.requireVault().blockedUntil(agent) as Promise<bigint>;
  }

  /** Resume a PAUSED task — pulls USDC from wallet via vault; both parties must reach ≥ $8. */
  async emergencyTopUp(taskId: bigint, amount: bigint) {
    return this.registry.emergencyTopUp(taskId, amount);
  }

  async checkTaskBalance(taskId: bigint) {
    return this.registry.checkTaskBalance(taskId);
  }

  async maxWithdrawableDeposit(agent: string) {
    return this.registry.maxWithdrawableDeposit(agent) as Promise<bigint>;
  }

  async fundTask(taskId: bigint, amount: bigint) {
    return this.registry.fundTask(taskId, amount);
  }

  async submitProof(taskId: bigint, milestoneIndex: number, receiptHash: string) {
    return this.registry.submitProof(taskId, milestoneIndex, receiptHash);
  }

  async acceptMilestone(taskId: bigint, milestoneIndex: number) {
    return this.registry.acceptMilestone(taskId, milestoneIndex);
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

  /** Party-only; tier += 1 up to MAX_TIERS (3) while dispute is OPEN. */
  async escalate(disputeId: bigint) {
    if (!this.arbitration) {
      throw new Error("AzzleClient: arbitrationAddress required for escalate");
    }
    return this.arbitration.escalate(disputeId);
  }
}

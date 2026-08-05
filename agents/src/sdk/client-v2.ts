import { Contract, ethers } from "ethers";
import type { BaseMainnetV2Manifest } from "./manifest-v2.js";

const REGISTRY_ABI = [
  "function post(uint256 totalAmount,uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)", "function fund(uint256 taskId,uint256 amount)",
  "function activate(uint256 taskId)", "function release(uint256 taskId,uint256 amount)",
  "function complete(uint256 taskId)", "function cancel(uint256 taskId)",
  "function markDelivered(uint256 taskId)", "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId,bytes32 evidenceHash)",
  "function taskState(uint256 taskId) view returns (uint8)",
  "function tasks(uint256 taskId) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint64 fundingDeadline,uint64 deliveredAt,uint8 state)",
  "event TaskPosted(uint256 indexed taskId,address indexed poster,uint256 totalAmount,uint256 amountUsd6,uint64 deadline)",
];
const VAULT_ABI = [
  "function withdraw(uint256 amount,address recipient)", "function claimPayout(address recipient)",
  "function deposits(address) view returns (uint256)", "function withdrawable(address) view returns (uint256)",
];
const GATEWAY_ABI = [
  "function fundWithUsdc(uint256 exactUsdcIn,uint256 minAzlOut,uint256 deadline) returns (uint256)",
  "function fundWithEth(uint256 minAzlOut,uint256 deadline) payable returns (uint256)",
  "function intakePaused() view returns (bool)",
];
const STAKING_ABI = [
  "function stake(uint256 amount)", "function unstake(uint256 amount)",
  "function claim(address recipient)", "function claimPayout(address recipient)",
  "function stakeOf(address) view returns (uint256)", "function accrued(address) view returns (uint256)",
  "function stakingActive() view returns (bool)", "function activateStaking()",
  "function creditsOf(address) view returns (uint256)", "function creditsRemaining() view returns (uint256)",
  "function bankCredits()",
];
const BONDS_ABI = [
  "function bond(uint256 amount)", "function scheduleWithdrawal()", "function withdraw(uint256 amount)",
  "function claimPayout(address recipient)", "function bonds(address) view returns (uint256)",
];
const SCOPE_ABI = ["function publish(uint256 taskId,string scope)", "function scopeOf(uint256 taskId) view returns (string)"];
const ARBITRATION_ABI = [
  "function submitEvidence(uint256 taskId,bytes32 evidenceHash)",
  "function beginRuling(uint256 taskId)",
  "function rule(uint256 taskId,uint8 outcome,uint16 workerBps)",
  "function timeout(uint256 taskId)",
];

export const V2_TASK_STATE_NAMES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"] as const;

export class AzzleV2Client {
  private provider: ethers.JsonRpcProvider;
  private registry: Contract;
  private vault: Contract;
  private gateway: Contract;
  private staking: Contract;
  private bonds: Contract;
  private arbitration: Contract;
  private scope: Contract;

  constructor(public readonly manifest: BaseMainnetV2Manifest, rpcUrl: string) {
    if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") throw new Error("AzzleV2Client: invalid V2 manifest");
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.registry = new Contract(manifest.taskRegistry, REGISTRY_ABI, this.provider);
    this.vault = new Contract(manifest.depositVault, VAULT_ABI, this.provider);
    this.gateway = new Contract(manifest.paymentGateway, GATEWAY_ABI, this.provider);
    this.staking = new Contract(manifest.stakingVault, STAKING_ABI, this.provider);
    this.bonds = new Contract(manifest.verifierBondVault, BONDS_ABI, this.provider);
    this.arbitration = new Contract(manifest.arbitrationModule, ARBITRATION_ABI, this.provider);
    this.scope = new Contract(manifest.taskScopeRegistry, SCOPE_ABI, this.provider);
  }

  connect(signer: ethers.Signer) {
    this.registry = this.registry.connect(signer) as Contract;
    this.vault = this.vault.connect(signer) as Contract;
    this.gateway = this.gateway.connect(signer) as Contract;
    this.staking = this.staking.connect(signer) as Contract;
    this.bonds = this.bonds.connect(signer) as Contract;
    this.arbitration = this.arbitration.connect(signer) as Contract;
    this.scope = this.scope.connect(signer) as Contract;
    return this;
  }

  async post(totalAmount: bigint, deadline: number) {
    const tx = await this.registry.post(totalAmount, deadline);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("AzzleV2Client: post failed");
    const iface = new ethers.Interface(REGISTRY_ABI);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== this.manifest.taskRegistry.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "TaskPosted") return { taskId: parsed.args.taskId as bigint, receipt };
      } catch { /* unrelated log */ }
    }
    throw new Error("AzzleV2Client: TaskPosted event missing");
  }

  claim(taskId: bigint) { return this.registry.claim(taskId); }
  fund(taskId: bigint, amount: bigint) { return this.registry.fund(taskId, amount); }
  activate(taskId: bigint) { return this.registry.activate(taskId); }
  release(taskId: bigint, amount: bigint) { return this.registry.release(taskId, amount); }
  markDelivered(taskId: bigint) { return this.registry.markDelivered(taskId); }
  expire(taskId: bigint) { return this.registry.expire(taskId); }
  complete(taskId: bigint) { return this.registry.complete(taskId); }
  cancel(taskId: bigint) { return this.registry.cancel(taskId); }
  openDispute(taskId: bigint, evidenceHash: string) { return this.registry.openDispute(taskId, evidenceHash); }
  publishScope(taskId: bigint, scope: string) { return this.scope.publish(taskId, scope); }
  getScope(taskId: bigint) { return this.scope.scopeOf(taskId) as Promise<string>; }
  taskState(taskId: bigint) { return this.registry.taskState(taskId) as Promise<bigint>; }
  getTask(taskId: bigint) { return this.registry.tasks(taskId); }

  fundDepositWithUsdc(exactUsdcIn: bigint, minAzlOut: bigint, deadline: number) {
    return this.gateway.fundWithUsdc(exactUsdcIn, minAzlOut, deadline);
  }
  fundDepositWithEth(exactEthIn: bigint, minAzlOut: bigint, deadline: number) {
    return this.gateway.fundWithEth(minAzlOut, deadline, { value: exactEthIn });
  }
  isDepositIntakePaused() { return this.gateway.intakePaused() as Promise<boolean>; }
  withdrawDeposit(amount: bigint, recipient: string) { return this.vault.withdraw(amount, recipient); }
  claimDepositPayout(recipient: string) { return this.vault.claimPayout(recipient); }
  depositBalance(account: string) { return this.vault.deposits(account) as Promise<bigint>; }
  withdrawableDeposit(account: string) { return this.vault.withdrawable(account) as Promise<bigint>; }

  stake(amount: bigint) { return this.staking.stake(amount); }
  unstake(amount: bigint, recipient: string) { return this.staking.unstake(amount, recipient); }
  claimRewards(recipient: string) { return this.staking.claim(recipient); }
  claimStakingPayout(recipient: string) { return this.staking.claimPayout(recipient); }
  activateStaking() { return this.staking.activateStaking(); }
  actionCredits(account: string) { return this.staking.creditsOf(account) as Promise<bigint>; }
  actionCreditsRemaining() { return this.staking.creditsRemaining() as Promise<bigint>; }
  bankActionCredits() { return this.staking.bankCredits(); }
  isStakingActive() { return this.staking.stakingActive() as Promise<boolean>; }

  bondVerifier(amount: bigint) { return this.bonds.bond(amount); }
  scheduleVerifierBondWithdrawal() { return this.bonds.scheduleWithdrawal(); }
  withdrawVerifierBond(amount: bigint) { return this.bonds.withdraw(amount); }
  claimBondPayout(recipient: string) { return this.bonds.claimPayout(recipient); }

  submitEvidence(taskId: bigint, evidenceHash: string) { return this.arbitration.submitEvidence(taskId, evidenceHash); }
  beginRuling(taskId: bigint) { return this.arbitration.beginRuling(taskId); }
  rule(taskId: bigint, outcome: number, workerBps: number) { return this.arbitration.rule(taskId, outcome, workerBps); }
  timeout(taskId: bigint) { return this.arbitration.timeout(taskId); }
}
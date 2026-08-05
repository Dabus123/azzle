/** Bounded direct Base RPC reader for agent task discovery. */
import { ethers } from "ethers";
import { BASE_MAINNET_MANIFEST } from "./manifest.js";

export interface BaseRpcTask {
  id: string;
  state: string;
  poster: { id: string };
  worker: { id: string } | null;
  escrowAmount: string;
  createdAt: string;
  updatedAt: string;
  settlementDigest: string | null;
}

export interface BaseRpcAgent {
  id: string;
  reputationScore: string;
  tasksCompleted: number;
  disputesWon: number;
  disputesLost: number;
  verifierBondEth: string;
  signals: Array<{ id: string; signalType: string; weight: string; emittedAt: string; taskId: string }>;
}

export interface BaseRpcIndexerConfig {
  rpcUrl?: string;
  scanWindow?: number;
}

const TASK_ABI = [
  "function taskCount() view returns (uint256)",
  "function tasks(uint256) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint8 state)",
];
const STATES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];

export class BaseRpcIndexer {
  readonly rpcUrl: string;
  private readonly provider: ethers.JsonRpcProvider;
  private readonly registry: ethers.Contract;
  private readonly scanWindow: number;

  constructor(config: BaseRpcIndexerConfig = {}) {
    this.rpcUrl = config.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
    this.provider = new ethers.JsonRpcProvider(this.rpcUrl);
    this.registry = new ethers.Contract(BASE_MAINNET_MANIFEST.taskRegistry, TASK_ABI, this.provider);
    this.scanWindow = Math.max(100, config.scanWindow ?? 400);
  }

  private mapTask(id: bigint, task: any): BaseRpcTask | null {
    if (!task.poster || task.poster === ethers.ZeroAddress) return null;
    return {
      id: `v2:${id.toString()}`, state: STATES[Number(task.state)] ?? "UNKNOWN",
      poster: { id: task.poster }, worker: task.worker === ethers.ZeroAddress ? null : { id: task.worker },
      escrowAmount: task.totalAmount.toString(), createdAt: "0",
      updatedAt: "0", settlementDigest: null,
    };
  }

  private async recent(limit: number, predicate: (task: BaseRpcTask) => boolean = () => true) {
    const count = await this.registry.taskCount() as bigint;
    const tasks: BaseRpcTask[] = [];
    const start = count > BigInt(this.scanWindow) ? count - BigInt(this.scanWindow) + 1n : 1n;
    for (let id = count; id >= start && tasks.length < limit; id -= 1n) {
      const task = this.mapTask(id, await this.registry.tasks(id));
      if (task && predicate(task)) tasks.push(task);
    }
    return tasks;
  }

  async getOpenTasks(limit = 100) { return this.recent(Math.min(Math.max(limit, 1), 100), (task) => task.state === "POSTED"); }
  async getRecentTasks(limit = 50) { return this.recent(Math.min(Math.max(limit, 1), 100)); }
  async getTask(taskId: string | bigint) {
    const id = BigInt(taskId);
    return this.mapTask(id, await this.registry.tasks(id));
  }
  async getTasksByPoster(poster: string, limit = 25) {
    const normalized = poster.toLowerCase();
    return this.recent(Math.min(Math.max(limit, 1), 100), (task) => task.poster.id.toLowerCase() === normalized);
  }
  async getTasksByWorker(worker: string, limit = 25) {
    const normalized = worker.toLowerCase();
    return this.recent(Math.min(Math.max(limit, 1), 100), (task) => task.worker?.id.toLowerCase() === normalized);
  }
}

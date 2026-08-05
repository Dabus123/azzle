/** Base RPC discovery client for the canonical V2 TaskRegistry. */
import { Contract, JsonRpcProvider } from "ethers";
import { BASE_MAINNET_MANIFEST } from "./manifest.js";
import { TASK_STATE_NAMES } from "./client.js";

const ABI = [
  "function taskCount() view returns (uint256)",
  "function tasks(uint256) view returns (address poster,address worker,uint256 totalAmount,uint256 funded,uint256 released,uint64 deadline,uint8 state)",
];
const ZERO = "0x0000000000000000000000000000000000000000";

export interface RpcDiscoveryTask {
  protocolVersion: "v2"; asset: "AZL"; registryAddress: string;
  id: string; state: string; poster: { id: string }; worker: { id: string } | null;
  escrowAmount: string; createdAt: string; updatedAt: string; settlementDigest: string | null;
}
export interface RpcDiscoveryConfig {
  rpcUrl?: string; registryAddress?: string; scanWindow?: number;
}

export class RpcDiscovery {
  private readonly registry: Contract;
  private readonly scanWindow: number;
  constructor(config: RpcDiscoveryConfig = {}) {
    this.registry = new Contract(
      config.registryAddress ?? BASE_MAINNET_MANIFEST.taskRegistry,
      ABI,
      new JsonRpcProvider(config.rpcUrl ?? process.env.BASE_RPC_URL ?? "https://mainnet.base.org")
    );
    this.scanWindow = Math.min(Math.max(config.scanWindow ?? 5_000, 100), 10_000);
  }
  private map(id: bigint, row: any): RpcDiscoveryTask {
    const createdAt = "0";
    const worker = String(row.worker).toLowerCase();
    return {
      protocolVersion: "v2", asset: "AZL", registryAddress: String(this.registry.target),
      id: `v2:${id.toString()}`, state: ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"][Number(row.state)] ?? `UNKNOWN(${row.state})`,
      poster: { id: String(row.poster).toLowerCase() },
      worker: worker === ZERO ? null : { id: worker },
      escrowAmount: row.totalAmount.toString(), createdAt, updatedAt: createdAt,
      settlementDigest: null,
    };
  }
  private async scan(filter: (task: RpcDiscoveryTask) => boolean, limit: number) {
    const total = Number(await this.registry.taskCount());
    const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
    const start = Math.max(1, total - this.scanWindow + 1);
    const out: RpcDiscoveryTask[] = [];
    for (let id = total; id >= start && out.length < first; id--) {
      try {
        const task = this.map(BigInt(id), await this.registry.tasks(id));
        if (filter(task)) out.push(task);
      } catch { /* ignore an invalid historical row */ }
    }
    return out;
  }
  getOpenTasks(limit = 100) { return this.scan((task) => task.state === "POSTED", limit); }
  getRecentTasks(limit = 50) { return this.scan(() => true, limit); }
  getTasksByPoster(poster: string, limit = 25) {
    const id = poster.toLowerCase();
    return this.scan((task) => task.poster.id === id, limit);
  }
  getTasksByWorker(worker: string, limit = 25) {
    const id = worker.toLowerCase();
    return this.scan((task) => task.worker?.id === id, limit);
  }
  async getTask(taskId: string | bigint) {
    try {
      const task = this.map(BigInt(taskId), await this.registry.tasks(taskId));
      return task.poster.id === ZERO ? null : task;
    } catch { return null; }
  }
}

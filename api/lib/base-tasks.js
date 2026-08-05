/** Canonical AZZLE task reads from Base RPC; no external indexer required. */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

export const TASK_STATES = [
  "NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED",
  "COMPLETED", "CANCELLED", "RESOLVED",
];
const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const MAX_SCAN = Number(process.env.AZZLE_TASK_SCAN_WINDOW ?? 400);
const BATCH_SIZE = 50;

export const REGISTRY_ABI = [
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "tasks", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple", components: [
        { name: "poster", type: "address" }, { name: "worker", type: "address" },
        { name: "totalAmount", type: "uint256" }, { name: "funded", type: "uint256" },
        { name: "released", type: "uint256" }, { name: "deadline", type: "uint64" },
        { name: "fundingDeadline", type: "uint64" }, { name: "deliveredAt", type: "uint64" },
        { name: "state", type: "uint8" },
      ],
    }],
  },
];
export const ESCROW_ABI = [
  { type: "function", name: "lockedBalance", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }], outputs: [{ type: "uint256" }] },
];

let client;
export function baseClient() {
  client ??= createPublicClient({ chain: base, transport: http(RPC_URL) });
  return client;
}

export function parseLimit(raw, fallback = 50) {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 1), 100) : fallback;
}

export function parseTaskId(raw) {
  const id = String(raw ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Invalid task id");
  return id;
}

export function normalizeTask(id, task) {
  const state = TASK_STATES[Number(task.state)] ?? "UNKNOWN";
  return {
    id: String(id),
    protocolVersion: "v2",
    asset: "AZL",
    state,
    escrowAmount: task.totalAmount.toString(),
    totalAmountAzlWei: task.totalAmount.toString(),
    fundedAzlWei: task.funded.toString(),
    releasedAzlWei: task.released.toString(),
    budgetAzl: Number(formatUnits(task.totalAmount, 18)),
    createdAt: null,
    updatedAt: Number(task.deliveredAt ?? 0),
    poster: task.poster.toLowerCase(),
    worker: task.worker && task.worker !== zeroAddress ? task.worker : null,
    deadline: Number(task.deadline),
    fundingDeadline: Number(task.fundingDeadline ?? 0),
    deliveredAt: Number(task.deliveredAt ?? 0),
    fundedAmount: task.funded.toString(),
    releasedAmount: task.released.toString(),
  };
}

export async function getTaskRow(taskIdRaw) {
  const id = parseTaskId(taskIdRaw);
  const task = await baseClient().readContract({
    address: MANIFEST.taskRegistry, abi: REGISTRY_ABI, functionName: "tasks", args: [BigInt(id)],
  });
  if (!task?.poster || task.poster === zeroAddress) return null;
  return normalizeTask(id, task);
}

/** Latest tasks are bounded deliberately: the site only presents the recent market. */
export async function listRecentTaskRows(limitRaw = 50, predicate = () => true) {
  const limit = parseLimit(limitRaw);
  const count = Number(await baseClient().readContract({
    address: MANIFEST.taskRegistry, abi: REGISTRY_ABI, functionName: "taskCount",
  }));
  if (!count) return [];
  const start = Math.max(1, count - Math.max(MAX_SCAN, limit) + 1);
  const ids = Array.from({ length: count - start + 1 }, (_, index) => BigInt(count - index));
  const rows = [];
  for (let offset = 0; offset < ids.length && rows.length < limit; offset += BATCH_SIZE) {
    const batch = ids.slice(offset, offset + BATCH_SIZE);
    const result = await baseClient().multicall({
      allowFailure: true,
      contracts: batch.map((id) => ({
        address: MANIFEST.taskRegistry, abi: REGISTRY_ABI, functionName: "tasks", args: [id],
      })),
    });
    for (let index = 0; index < result.length && rows.length < limit; index += 1) {
      const task = result[index].result;
      if (!task?.poster || task.poster === zeroAddress) continue;
      const row = normalizeTask(batch[index], task);
      if (predicate(row)) rows.push(row);
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLockedBalance(taskId) {
  return baseClient().readContract({
    address: MANIFEST.escrowVault, abi: ESCROW_ABI, functionName: "lockedBalance", args: [BigInt(taskId)],
  });
}

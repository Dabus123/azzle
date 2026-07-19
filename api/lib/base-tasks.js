/** Canonical AZZLE task reads from Base RPC; no external indexer required. */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

export const TASK_STATES = [
  "DRAFT", "POSTED", "CLAIMED", "ACTIVE", "IN_REVIEW", "COMPLETED",
  "CANCELLED", "EXPIRED", "DISPUTED", "RESOLVED", "REPLACING", "PAUSED", "DELETED",
];
const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const MAX_SCAN = Number(process.env.AZZLE_TASK_SCAN_WINDOW ?? 400);
const BATCH_SIZE = 50;

export const REGISTRY_ABI = [
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "getTask", stateMutability: "view", inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple", components: [
        { name: "poster", type: "address" }, { name: "worker", type: "address" },
        { name: "token", type: "address" }, { name: "totalAmount", type: "uint256" },
        { name: "escrowMode", type: "uint8" }, { name: "settlementDigest", type: "bytes32" },
        { name: "state", type: "uint8" }, { name: "deadline", type: "uint256" },
        { name: "createdAt", type: "uint256" }, { name: "replacementAllowed", type: "bool" },
        { name: "parentTaskId", type: "uint256" },
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
    state,
    escrowAmount: task.totalAmount.toString(),
    budgetUsdc: Number(formatUnits(task.totalAmount, 6)),
    createdAt: Number(task.createdAt),
    updatedAt: Number(task.createdAt),
    poster: task.poster,
    worker: task.worker && task.worker !== zeroAddress ? task.worker : null,
    settlementDigest: task.settlementDigest || null,
    deadline: Number(task.deadline),
    escrowMode: Number(task.escrowMode),
    replacementAllowed: Boolean(task.replacementAllowed),
    parentTaskId: String(task.parentTaskId ?? 0n),
  };
}

export async function getTaskRow(taskIdRaw) {
  const id = parseTaskId(taskIdRaw);
  const task = await baseClient().readContract({
    address: MANIFEST.TaskRegistry, abi: REGISTRY_ABI, functionName: "getTask", args: [BigInt(id)],
  });
  if (!task?.poster || task.poster === zeroAddress || task.createdAt === 0n) return null;
  return normalizeTask(id, task);
}

/** Latest tasks are bounded deliberately: the site only presents the recent market. */
export async function listRecentTaskRows(limitRaw = 50, predicate = () => true) {
  const limit = parseLimit(limitRaw);
  const count = Number(await baseClient().readContract({
    address: MANIFEST.TaskRegistry, abi: REGISTRY_ABI, functionName: "taskCount",
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
        address: MANIFEST.TaskRegistry, abi: REGISTRY_ABI, functionName: "getTask", args: [id],
      })),
    });
    for (let index = 0; index < result.length && rows.length < limit; index += 1) {
      const task = result[index].result;
      if (!task?.poster || task.poster === zeroAddress || task.createdAt === 0n) continue;
      const row = normalizeTask(batch[index], task);
      if (predicate(row)) rows.push(row);
    }
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getLockedBalance(taskId) {
  return baseClient().readContract({
    address: MANIFEST.EscrowVault, abi: ESCROW_ABI, functionName: "lockedBalance", args: [BigInt(taskId)],
  });
}

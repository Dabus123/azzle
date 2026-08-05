/** Authoritative Base RPC task reader with bounded scans and stale cache. */
import { createPublicClient, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const FRESH_MS = 30_000;
const STALE_MS = 5 * 60_000;
const MAX_SCAN = 5_000;
const BATCH_SIZE = 100;
const STATES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];

const ABI = [
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function", name: "tasks", stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "poster", type: "address" }, { name: "worker", type: "address" },
        { name: "totalAmount", type: "uint256" }, { name: "funded", type: "uint256" },
        { name: "released", type: "uint256" }, { name: "deadline", type: "uint64" },
        { name: "fundingDeadline", type: "uint64" }, { name: "deliveredAt", type: "uint64" },
        { name: "state", type: "uint8" },
      ],
    }],
  },
];

let client;
let cache;
let inflight;

function rpc() {
  client ??= createPublicClient({ chain: base, transport: http(RPC_URL) });
  return client;
}

function mapTask(id, row) {
  const state = STATES[Number(row.state)] ?? "UNKNOWN";
  const worker = row.worker === zeroAddress ? null : row.worker;
  return {
    id: String(id), state, escrowAmount: row.totalAmount.toString(),
    budgetAzl: Number(row.totalAmount) / 1e18, createdAt: Number(row.deliveredAt),
    updatedAt: Number(row.deliveredAt), poster: row.poster, worker,
    fundedAmount: row.funded.toString(), releasedAmount: row.released.toString(),
    settlementDigest: null, deadline: Number(row.deadline), asset: "AZL",
  };
}

async function readSnapshot() {
  const count = Number(await rpc().readContract({
    address: MANIFEST.taskRegistry, abi: ABI, functionName: "taskCount",
  }));
  const scanned = Math.min(count, MAX_SCAN);
  const start = count - scanned + 1;
  const tasks = [];
  for (let offset = 0; offset < scanned; offset += BATCH_SIZE) {
    const end = Math.min(start + offset + BATCH_SIZE, count + 1);
    const ids = Array.from({ length: end - (start + offset) }, (_, i) => BigInt(start + offset + i));
    const rows = await rpc().multicall({
      contracts: ids.map((id) => ({
        address: MANIFEST.taskRegistry, abi: ABI, functionName: "tasks", args: [id],
      })),
      allowFailure: true,
    });
    rows.forEach((result, index) => {
      if (result.status === "success" && result.result) tasks.push(mapTask(ids[index], result.result));
    });
  }
  tasks.sort((a, b) => b.createdAt - a.createdAt || Number(b.id) - Number(a.id));
  return { tasks, taskCount: count, scanned, partial: scanned < count, fetchedAt: Date.now() };
}

/** Returns a cached recent task snapshot; stale data is returned only during RPC outages. */
export async function taskSnapshot() {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < FRESH_MS) return cache;
  if (inflight) return inflight;
  inflight = readSnapshot()
    .then((snapshot) => (cache = snapshot))
    .catch((error) => {
      if (cache && now - cache.fetchedAt < STALE_MS) return cache;
      throw error;
    })
    .finally(() => { inflight = undefined; });
  return inflight;
}

export async function listTasks({ limit = 100, state, poster, worker } = {}) {
  const snapshot = await taskSnapshot();
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const address = typeof poster === "string" ? poster.toLowerCase() : null;
  const workerAddress = typeof worker === "string" ? worker.toLowerCase() : null;
  const tasks = snapshot.tasks.filter((task) =>
    (!state || task.state === state) &&
    (!address || task.poster.toLowerCase() === address) &&
    (!workerAddress || task.worker?.toLowerCase() === workerAddress)
  ).slice(0, first);
  return { tasks, meta: {
    taskCount: snapshot.taskCount, scanned: snapshot.scanned, partial: snapshot.partial,
    fetchedAt: Math.floor(snapshot.fetchedAt / 1000), source: "base-rpc",
  }};
}

export { ABI as TASK_REGISTRY_ABI, STATES as TASK_STATES };

/** Onchain fallback for open tasks when subgraph is rate-limited. */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const POSTED = 1;
const SCAN_WINDOW = 400;

const REGISTRY_ABI = [
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "token", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "escrowMode", type: "uint8" },
          { name: "settlementDigest", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "deadline", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "replacementAllowed", type: "bool" },
          { name: "parentTaskId", type: "uint256" },
        ],
      },
    ],
  },
];

let client = null;

function getClient() {
  if (!client) {
    client = createPublicClient({ chain: base, transport: http(RPC_URL) });
  }
  return client;
}

/** @param {number} limit */
export async function getOpenTasksOnchain(limit = 100) {
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const publicClient = getClient();
  const count = await publicClient.readContract({
    address: MANIFEST.TaskRegistry,
    abi: REGISTRY_ABI,
    functionName: "taskCount",
  });

  const total = Number(count);
  if (!total) return [];

  const start = Math.max(1, total - SCAN_WINDOW + 1);
  const ids = [];
  for (let id = total; id >= start; id--) ids.push(BigInt(id));

  const posted = [];
  const batchSize = 50;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await publicClient.multicall({
      contracts: batch.map((id) => ({
        address: MANIFEST.TaskRegistry,
        abi: REGISTRY_ABI,
        functionName: "getTask",
        args: [id],
      })),
    });

    for (let j = 0; j < batch.length; j++) {
      const row = results[j]?.result;
      if (!row || Number(row.state) !== POSTED) continue;
      const taskId = String(batch[j]);
      posted.push({
        id: taskId,
        state: "POSTED",
        escrowAmount: row.totalAmount.toString(),
        budgetUsdc: Number(row.totalAmount) / 1e6,
        createdAt: Number(row.createdAt),
        updatedAt: Number(row.createdAt),
        poster: row.poster,
      });
    }
  }

  posted.sort((a, b) => b.createdAt - a.createdAt);
  return posted.slice(0, first);
}

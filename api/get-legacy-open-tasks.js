import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Archived V1 registry. This route is intentionally isolated from active V2.
const LEGACY_REGISTRY =
  process.env.AZZLE_LEGACY_TASK_REGISTRY ||
  ["0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48"].join("");
const LEGACY_ABI = [{
  type: "function",
  name: "taskCount",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint256" }],
}, {
  type: "function",
  name: "tasks",
  stateMutability: "view",
  inputs: [{ name: "taskId", type: "uint256" }],
  outputs: [{
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
  }],
}];

const LEGACY_STATES = [
  "DRAFT", "POSTED", "CLAIMED", "ACTIVE", "IN_REVIEW", "COMPLETED",
  "CANCELLED", "EXPIRED", "DISPUTED", "RESOLVED", "REPLACING", "PAUSED", "DELETED",
];

export async function listLegacyTasks(limit = 100) {
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.BASE_RPC_URL || "https://mainnet.base.org"),
    });
    const count = await client.readContract({ address: LEGACY_REGISTRY, abi: LEGACY_ABI, functionName: "taskCount" });
    const ids = [];
    for (let id = count; id > 0n && ids.length < limit; id--) ids.push(id);
    const results = await client.multicall({
      contracts: ids.map((id) => ({
        address: LEGACY_REGISTRY,
        abi: LEGACY_ABI,
        functionName: "tasks",
        args: [id],
      })),
      allowFailure: true,
    });
    const tasks = [];
    for (let index = 0; index < ids.length; index++) {
      const result = results[index];
      if (result.status !== "success" || !result.result) continue;
      const id = ids[index];
      const row = result.result;
      tasks.push({
        id: id.toString(),
        protocolVersion: "v1-archived",
        registry: LEGACY_REGISTRY,
        state: LEGACY_STATES[Number(row.state)] || "UNKNOWN",
        poster: row.poster,
        worker: row.worker,
        totalAmountWei: row.totalAmount.toString(),
        budgetAzl: (Number(row.totalAmount) / 1e18).toString(),
        settlementDigest: row.settlementDigest,
        deadline: Number(row.deadline),
        createdAt: Number(row.createdAt),
      });
    }
    return {
      protocol: "azzle",
      protocolVersion: "v1-archived",
      chainId: 8453,
      registry: LEGACY_REGISTRY,
      tasks,
      count: tasks.length,
      readOnly: true,
      warning: "Legacy V1 data only. V1 is no longer actively maintained and is incompatible with V2.",
    };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  try {
    const url = new URL(req.url || "/", `https://${req.headers.host || "azzle.org"}`);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 100);
    const result = await listLegacyTasks(limit);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");
    res.statusCode = 200;
    res.end(JSON.stringify(result));
  } catch (error) {
    res.statusCode = 502;
    const message = error?.message || "legacy RPC unavailable";
    const rateLimited = /rate limit|429|too many requests/i.test(message);
    res.end(JSON.stringify({
      error: rateLimited ? "legacy_rpc_rate_limited" : "legacy_archive_unavailable",
      message,
    }));
  }
}

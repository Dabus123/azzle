/** Explicit AZL-only V2 Base RPC reader. No fallback to the legacy manifest. */
import { createPublicClient, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rankTask, resolveMetadata, metadataTrust } from "./marketplace-metadata.js";

const MAX_SCAN = 5_000;
const BATCH_SIZE = 100;
const STATES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];
const ABI = [
  { type: "function", name: "taskCount", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "tasks", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [
    { name: "poster", type: "address" }, { name: "worker", type: "address" },
    { name: "totalAmount", type: "uint256" }, { name: "funded", type: "uint256" },
    { name: "released", type: "uint256" }, { name: "deadline", type: "uint64" }, { name: "state", type: "uint8" },
  ] },
];

let cache;
function manifest() {
  const path = process.env.AZZLE_V2_MANIFEST
    ?? resolve(process.cwd(), "contracts/deployments/base-8453.json");
  cache ??= JSON.parse(readFileSync(resolve(path), "utf8"));
  if (cache.version !== "2.0.0" || cache.chainId !== "8453") throw new Error("invalid AZZLE V2 manifest");
  return cache;
}

export async function listV2Tasks({
  limit = 100, state, poster, worker, minAmountAzlWei, cursor,
  taskType, capability, verificationMode, beforeDeadline, metadataUri,
} = {}) {
  const m = manifest();
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const count = Number(await client.readContract({ address: m.taskRegistry, abi: ABI, functionName: "taskCount" }));
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const before = cursor ? Number(cursor) : count + 1;
  const minimum = minAmountAzlWei ? BigInt(minAmountAzlWei) : 0n;
  const out = [];
  for (let id = Math.min(count, before - 1); id >= 1 && out.length < first; id--) {
    const row = await client.readContract({ address: m.taskRegistry, abi: ABI, functionName: "tasks", args: [BigInt(id)] });
    const task = {
      protocolVersion: "v2", id: `v2:${id}`, localTaskId: String(id), asset: "AZL",
      state: STATES[Number(row[6])] ?? "UNKNOWN", poster: row[0], worker: row[1] === zeroAddress ? null : row[1],
      totalAmountAzlWei: row[2].toString(), fundedAzlWei: row[3].toString(), releasedAzlWei: row[4].toString(),
      deadline: Number(row[5]), registry: m.taskRegistry,
    };
    if (metadataUri) task.metadata = await resolveMetadata(metadataUri);
    if (task.metadata) task.metadataTrust = metadataTrust(task.metadata);
    if (state && task.state !== state) continue;
    if (poster && task.poster.toLowerCase() !== String(poster).toLowerCase()) continue;
    if (worker && task.worker?.toLowerCase() !== String(worker).toLowerCase()) continue;
    if (BigInt(task.totalAmountAzlWei) < minimum) continue;
    const score = rankTask(task, { minAmountAzlWei, taskType, capability, verificationMode, beforeDeadline });
    if (score < 0) continue;
    task.matchScore = score;
    out.push(task);
  }
  out.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0) || Number(b.localTaskId) - Number(a.localTaskId));
  return {
    tasks: out,
    meta: {
      protocolVersion: "v2", asset: "AZL", taskCount: count, source: "base-rpc",
      nextCursor: out.length === first ? String(Number(out[out.length - 1].localTaskId)) : null,
    },
  };
}
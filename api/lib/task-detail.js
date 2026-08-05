/** Task detail — authoritative onchain read. */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const TASK_STATE = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "tasks",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "funded", type: "uint256" },
          { name: "released", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "fundingDeadline", type: "uint64" },
          { name: "deliveredAt", type: "uint64" },
          { name: "state", type: "uint8" },
        ],
      },
    ],
  },
];

const ESCROW_ABI = [
  {
    type: "function",
    name: "lockedBalance",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];

let client = null;

function getClient() {
  if (!client) {
    client = createPublicClient({ chain: base, transport: http(RPC_URL) });
  }
  return client;
}

function parseTaskId(raw) {
  const value = String(raw ?? "").trim();
  const id = value.startsWith("v2:") ? value.slice(3) : value;
  if (!/^\d+$/.test(id)) throw new Error("Invalid task id");
  return id;
}

export async function getTaskDetail(taskIdRaw) {
  const taskId = parseTaskId(taskIdRaw);
  const id = BigInt(taskId);

  const [task, locked] = await Promise.all([
    getClient().readContract({
      address: MANIFEST.taskRegistry,
      abi: REGISTRY_ABI,
      functionName: "tasks",
      args: [id],
    }),
    getClient().readContract({
      address: MANIFEST.escrowVault,
      abi: ESCROW_ABI,
      functionName: "lockedBalance",
      args: [id],
    }),
  ]);

  if (!task?.poster || task.poster === zeroAddress) {
    return null;
  }

  const stateIndex = Number(task.state);
  const state = TASK_STATE[stateIndex] ?? "UNKNOWN";
  const totalAmount = task.totalAmount;
  const lockedBal = locked ?? 0n;
  const budgetAzl = Number(formatUnits(totalAmount, 18));
  const lockedAzl = Number(formatUnits(lockedBal, 18));
  const poster = task.poster;
  const worker =
    task.worker !== zeroAddress
        ? task.worker
        : null;

  let onchainScope = null;
  try {
    const { readOnchainTaskScope } = await import("./task-scope.js");
    onchainScope = await readOnchainTaskScope(taskId);
  } catch {
    /* scope registry optional */
  }

  const description = onchainScope;
  const discoveryOpen = Boolean(onchainScope);
  const discoveryPrivate = !onchainScope;

  return {
    id: taskId,
    protocolVersion: "v2",
    asset: "AZL",
    state,
    budgetAzl,
    totalAmountAzlWei: totalAmount.toString(),
    fundedAzlWei: task.funded.toString(),
    releasedAzlWei: task.released.toString(),
    lockedAzl,
    funded: task.funded > 0n,
    escrowAmount: totalAmount.toString(),
    deadline: Number(task.deadline),
    createdAt: null,
    updatedAt: Number(task.deliveredAt),
    fundingDeadline: Number(task.fundingDeadline),
    deliveredAt: Number(task.deliveredAt),
    poster,
    worker,
    description,
    discoveryOpen,
    discoveryPrivate,
    scopeSource: onchainScope ? "onchain" : null,
    listingBudgetAzl: null,
    listingDeadlineDays: null,
    listingSavedAt: null,
    escrowMode: null,
    claimable: state === "POSTED",
    registryAddress: MANIFEST.taskRegistry,
    escrowAddress: MANIFEST.escrowVault,
    chainId: Number(MANIFEST.chainId),
  };
}

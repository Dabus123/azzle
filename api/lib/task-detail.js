/** Task detail — onchain read with optional subgraph enrichment. */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

import { subgraphGql } from "./subgraph.js";

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const TASK_STATE = [
  "DRAFT",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "IN_REVIEW",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "DISPUTED",
  "RESOLVED",
  "REPLACING",
  "PAUSED",
  "DELETED",
];

const REGISTRY_ABI = [
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
  const id = String(raw ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Invalid task id");
  return id;
}

async function fetchSubgraphTask(taskId) {
  try {
    const data = await subgraphGql(
      `query TaskById($id: ID!) {
        task(id: $id) {
          id
          state
          escrowAmount
          createdAt
          updatedAt
          settlementDigest
          poster { id }
          worker { id }
        }
      }`,
      { id: taskId }
    );
    return data?.task ?? null;
  } catch {
    return null;
  }
}

export async function getTaskDetail(taskIdRaw) {
  const taskId = parseTaskId(taskIdRaw);
  const id = BigInt(taskId);

  const [task, locked, row] = await Promise.all([
    getClient().readContract({
      address: MANIFEST.TaskRegistry,
      abi: REGISTRY_ABI,
      functionName: "getTask",
      args: [id],
    }),
    getClient().readContract({
      address: MANIFEST.EscrowVault,
      abi: ESCROW_ABI,
      functionName: "lockedBalance",
      args: [id],
    }),
    fetchSubgraphTask(taskId),
  ]);

  if (!task?.poster || task.poster === zeroAddress || task.createdAt === 0n) {
    return null;
  }

  const stateIndex = Number(task.state);
  const state = TASK_STATE[stateIndex] ?? row?.state ?? "UNKNOWN";
  const totalAmount = task.totalAmount;
  const lockedBal = locked ?? 0n;
  const budgetUsdc = Number(formatUnits(totalAmount, 6));
  const lockedUsdc = Number(formatUnits(lockedBal, 6));
  const poster = row?.poster?.id ?? task.poster;
  const worker =
    row?.worker?.id && row.worker.id !== zeroAddress
      ? row.worker.id
      : task.worker !== zeroAddress
        ? task.worker
        : null;

  const digest =
    row?.settlementDigest ??
    (task.settlementDigest ? task.settlementDigest : null);

  let listing = null;
  try {
    const { getTaskListing } = await import("./task-listings.js");
    listing = await getTaskListing(taskId);
  } catch {
    /* listing store optional */
  }

  let onchainScope = null;
  try {
    const { readOnchainTaskScope } = await import("./task-scope.js");
    onchainScope = await readOnchainTaskScope(taskId);
  } catch {
    /* scope registry optional */
  }

  const description = onchainScope ?? listing?.description ?? null;
  const discoveryOpen = Boolean(onchainScope);
  const discoveryPrivate = !onchainScope && !listing?.description;

  return {
    id: taskId,
    state,
    budgetUsdc,
    lockedUsdc,
    funded: lockedBal >= totalAmount && totalAmount > 0n,
    escrowAmount: totalAmount.toString(),
    deadline: Number(task.deadline),
    createdAt: Number(row?.createdAt ?? task.createdAt),
    updatedAt: Number(row?.updatedAt ?? 0),
    poster,
    worker,
    settlementDigest: digest,
    description,
    discoveryOpen,
    discoveryPrivate,
    scopeSource: onchainScope ? "onchain" : listing?.description ? "listing" : null,
    listingBudgetUsdc: listing?.budgetUsdc ?? null,
    listingDeadlineDays: listing?.deadlineDays ?? null,
    listingSavedAt: listing?.savedAt ?? null,
    escrowMode: Number(task.escrowMode),
    replacementAllowed: Boolean(task.replacementAllowed),
    parentTaskId: task.parentTaskId ? String(task.parentTaskId) : "0",
    claimable: state === "POSTED",
    registryAddress: MANIFEST.TaskRegistry,
    escrowAddress: MANIFEST.EscrowVault,
    chainId: Number(MANIFEST.chainId),
  };
}

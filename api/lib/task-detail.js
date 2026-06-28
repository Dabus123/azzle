/** Task detail — subgraph + onchain read (no wallet required). */
import { createPublicClient, formatUnits, http, zeroAddress } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const SUBGRAPH_URL =
  process.env.AZZLE_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

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

async function gql(query, variables) {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

function parseTaskId(raw) {
  const id = String(raw ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Invalid task id");
  return id;
}

export async function getTaskDetail(taskIdRaw) {
  const taskId = parseTaskId(taskIdRaw);
  const data = await gql(
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

  const row = data?.task;
  if (!row) return null;

  const publicClient = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
  });

  const id = BigInt(taskId);
  const [task, locked] = await publicClient.multicall({
    contracts: [
      {
        address: MANIFEST.TaskRegistry,
        abi: REGISTRY_ABI,
        functionName: "getTask",
        args: [id],
      },
      {
        address: MANIFEST.EscrowVault,
        abi: ESCROW_ABI,
        functionName: "lockedBalance",
        args: [id],
      },
    ],
  });

  const chainRow = task.result;
  const stateIndex = Number(chainRow.state);
  const state = TASK_STATE[stateIndex] ?? row.state ?? "UNKNOWN";
  const totalAmount = chainRow.totalAmount;
  const lockedBal = locked.result ?? 0n;
  const budgetUsdc = Number(formatUnits(totalAmount, 6));
  const lockedUsdc = Number(formatUnits(lockedBal, 6));
  const poster = row.poster?.id ?? chainRow.poster;
  const worker =
    row.worker?.id && row.worker.id !== zeroAddress
      ? row.worker.id
      : chainRow.worker !== zeroAddress
        ? chainRow.worker
        : null;

  const digest =
    row.settlementDigest ??
    (chainRow.settlementDigest ? chainRow.settlementDigest : null);

  return {
    id: taskId,
    state,
    budgetUsdc,
    lockedUsdc,
    funded: lockedBal >= totalAmount && totalAmount > 0n,
    escrowAmount: totalAmount.toString(),
    deadline: Number(chainRow.deadline),
    createdAt: Number(row.createdAt ?? chainRow.createdAt),
    updatedAt: Number(row.updatedAt ?? 0),
    poster,
    worker,
    settlementDigest: digest,
    escrowMode: Number(chainRow.escrowMode),
    replacementAllowed: Boolean(chainRow.replacementAllowed),
    parentTaskId: chainRow.parentTaskId ? String(chainRow.parentTaskId) : "0",
    claimable: state === "POSTED",
    registryAddress: MANIFEST.TaskRegistry,
    escrowAddress: MANIFEST.EscrowVault,
    chainId: Number(MANIFEST.chainId),
  };
}

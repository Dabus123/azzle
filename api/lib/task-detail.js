/** Task detail — canonical Base RPC read with optional application enrichment. */
import { formatUnits } from "viem";
import MANIFEST from "./contracts.json" with { type: "json" };
import { getLockedBalance, getTaskRow, parseTaskId } from "./base-tasks.js";

export async function getTaskDetail(taskIdRaw) {
  const taskId = parseTaskId(taskIdRaw);
  const [row, locked] = await Promise.all([getTaskRow(taskId), getLockedBalance(taskId)]);
  if (!row) return null;

  const totalAmount = BigInt(row.escrowAmount);
  const lockedBal = locked ?? 0n;
  const budgetUsdc = Number(formatUnits(totalAmount, 6));
  const lockedUsdc = Number(formatUnits(lockedBal, 6));

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
    state: row.state,
    budgetUsdc,
    lockedUsdc,
    funded: lockedBal >= totalAmount && totalAmount > 0n,
    escrowAmount: totalAmount.toString(),
    deadline: row.deadline,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    poster: row.poster,
    worker: row.worker,
    settlementDigest: row.settlementDigest,
    description,
    discoveryOpen,
    discoveryPrivate,
    scopeSource: onchainScope ? "onchain" : listing?.description ? "listing" : null,
    listingBudgetUsdc: listing?.budgetUsdc ?? null,
    listingDeadlineDays: listing?.deadlineDays ?? null,
    listingSavedAt: listing?.savedAt ?? null,
    escrowMode: row.escrowMode,
    replacementAllowed: row.replacementAllowed,
    parentTaskId: row.parentTaskId,
    claimable: row.state === "POSTED",
    registryAddress: MANIFEST.TaskRegistry,
    escrowAddress: MANIFEST.EscrowVault,
    chainId: Number(MANIFEST.chainId),
  };
}

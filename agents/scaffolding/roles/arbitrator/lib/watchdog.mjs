import { Contract } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

/** 7 days — arbitration/ESCALATION.md RESOLUTION_TIMEOUT */
export const RESOLUTION_TIMEOUT_SEC = 7 * 86_400;

const ARBITRATION_ABI = [
  "function disputes(uint256 disputeId) external view returns (tuple(uint256 taskId, address opener, address assignedArbitrator, uint8 state, uint256 openedAt, uint256 evidenceDeadline, uint256 tier, uint256 workerBps))",
];

export async function readDispute(provider, disputeId) {
  const mod = new Contract(manifest.arbitrationModule, ARBITRATION_ABI, provider);
  return mod.disputes(disputeId);
}

export async function isResolutionTimedOut(provider, disputeId, nowSec = BigInt(Math.floor(Date.now() / 1000))) {
  const d = await readDispute(provider, disputeId);
  const openedAt = d.openedAt ?? d[4];
  if (!openedAt) return { timedOut: false, openedAt: 0n };
  const elapsed = nowSec - BigInt(openedAt);
  return {
    timedOut: elapsed >= BigInt(RESOLUTION_TIMEOUT_SEC),
    openedAt: BigInt(openedAt),
    elapsedSec: elapsed,
    timeoutSec: RESOLUTION_TIMEOUT_SEC,
  };
}

export async function runResolutionWatchdog(client, provider, disputeId) {
  const status = await isResolutionTimedOut(provider, disputeId);
  console.log("[watchdog] dispute", disputeId.toString(), status);
  if (status.timedOut) {
    console.log("[watchdog] RESOLUTION_TIMEOUT exceeded — calling resolveTimedOut (50/50 fallback)");
    const tx = await client.resolveTimedOut(disputeId);
    await tx.wait();
    return { action: "resolveTimedOut", status };
  }
  const remaining = BigInt(RESOLUTION_TIMEOUT_SEC) - status.elapsedSec;
  console.log("[watchdog] time remaining (sec)", remaining.toString());
  return { action: "wait", status };
}

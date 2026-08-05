import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const ESCROW_ABI = ["function depositFor(uint256 taskId, uint256 amount) external"];

/**
 * fundTask pulls USDC from poster wallet into EscrowVault via TaskRegistry.fundTask.
 * Ensure USDC allowance → EscrowVault before calling.
 */
export async function fundTaskEscrow(client, signer, taskId, amountUsdc6) {
  const escrow = manifest.escrowVault;
  const usdc = new Contract(manifest.external.usdc, ERC20_ABI, signer);
  const allowance = await usdc.allowance(await signer.getAddress(), escrow);
  if (allowance < amountUsdc6) {
    console.log("[escrow] approving USDC for EscrowVault");
    const tx = await usdc.approve(escrow, ethers.MaxUint256);
    await tx.wait();
  }

  console.log("[escrow] fundTask", { taskId: taskId.toString(), amount: amountUsdc6.toString() });
  const tx = await client.fundTask(taskId, amountUsdc6);
  await tx.wait();
  console.log("[escrow] EscrowVault.depositFor complete via fundTask");
}

const TASK_STATE = { POSTED: 1, CLAIMED: 2, ACTIVE: 3 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search-market start: poll for a claim, then let the poster activate the task.
 * Direct-hire invitations must instead be activated by the invited worker via
 * acceptDirectHire; the poster cannot start them.
 */
export async function startMarketWorkWhenClaimed(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.START_WORK_TIMEOUT_MS ?? 300_000);
  const pollMs = options.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const state = await client.taskState(taskId);
    if (state === TASK_STATE.ACTIVE) {
      console.log("[escrow] task already ACTIVE", { taskId: taskId.toString() });
      return true;
    }
    if (state === TASK_STATE.CLAIMED) {
      console.log("[escrow] startWork", { taskId: taskId.toString() });
      const tx = await client.startWork(taskId);
      await tx.wait();
      console.log("[escrow] task ACTIVE — worker can now submitProof");
      return true;
    }
    if (state !== TASK_STATE.POSTED) {
      console.warn("[escrow] unexpected task state — skipping market startWork", {
        taskId: taskId.toString(),
        state,
      });
      return false;
    }
    if (Date.now() >= deadline) {
      console.warn(
        `[escrow] no worker claimed task ${taskId} within ${Math.round(timeoutMs / 1000)}s — ` +
          `run \`node agent.mjs start ${taskId}\` after a claim to activate it`
      );
      return false;
    }
    await sleep(pollMs);
  }
}

export async function acceptMilestone(client, taskId, milestoneIndex = 0) {
  console.log("[escrow] acceptMilestone", { taskId: taskId.toString(), milestoneIndex });
  const tx = await client.acceptMilestone(taskId, milestoneIndex);
  await tx.wait();
}

export async function openDispute(client, taskId, evidenceHash) {
  const evidence =
    typeof evidenceHash === "string"
      ? ethers.getBytes(evidenceHash.length === 66 ? evidenceHash : ethers.id(evidenceHash))
      : evidenceHash;
  console.log("[escrow] openDispute", { taskId: taskId.toString() });
  const tx = await client.openDispute(taskId, evidence);
  await tx.wait();
}

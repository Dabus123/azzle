import { Contract, ethers } from "ethers";
import manifest from "../base-8453.json" with { type: "json" };

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const ESCROW_ABI = ["function depositFor(uint256 taskId, uint256 amount) external"];

/**
 * fundTask pulls USDC from poster wallet into EscrowVault via TaskRegistry.fundTask.
 * Ensure USDC allowance → TaskRegistry before calling.
 */
export async function fundTaskEscrow(client, signer, taskId, amountUsdc6) {
  const registry = manifest.TaskRegistry;
  const usdc = new Contract(manifest.usdc, ERC20_ABI, signer);
  const allowance = (await usdc.allowance(await signer.getAddress(), registry)) as bigint;
  if (allowance < amountUsdc6) {
    console.log("[escrow] approving USDC for TaskRegistry");
    const tx = await usdc.approve(registry, ethers.MaxUint256);
    await tx.wait();
  }

  console.log("[escrow] fundTask", { taskId: taskId.toString(), amount: amountUsdc6.toString() });
  const tx = await client.fundTask(taskId, amountUsdc6);
  await tx.wait();
  console.log("[escrow] EscrowVault.depositFor complete via fundTask");
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

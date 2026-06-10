import { Contract, ethers } from "ethers";
import manifest from "../base-8453.json" with { type: "json" };

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const VAULT_ABI = ["function topUp(uint256 amount) external"];

/** Approve USDC for AgentDepositVault entry deposit ($20+). */
export async function ensureUsdcVaultApproval(signer, minAmount = 25_000_000n) {
  const wallet = await signer.getAddress();
  const usdc = new Contract(manifest.usdc, ERC20_ABI, signer);
  const allowance = (await usdc.allowance(wallet, manifest.AgentDepositVault)) as bigint;
  if (allowance >= minAmount) return;
  console.log("[approvals] approving USDC for AgentDepositVault");
  const tx = await usdc.approve(manifest.AgentDepositVault, ethers.MaxUint256);
  await tx.wait();
}

/** Approve AZZLE for TreasuryRouter access fees (1,000 AZL per action). */
export async function ensureAzlTreasuryApproval(signer, minAmount = 1_000n * 10n ** 18n) {
  const wallet = await signer.getAddress();
  const azl = new Contract(manifest.azlToken, ERC20_ABI, signer);
  const allowance = (await azl.allowance(wallet, manifest.TreasuryRouter)) as bigint;
  if (allowance >= minAmount) return;
  console.log("[approvals] approving AZZLE for TreasuryRouter");
  const tx = await azl.approve(manifest.TreasuryRouter, ethers.MaxUint256);
  await tx.wait();
}

export async function topUpVault(signer, amountUsdc6 = 20_000_000n) {
  await ensureUsdcVaultApproval(signer, amountUsdc6);
  const vault = new Contract(manifest.AgentDepositVault, VAULT_ABI, signer);
  console.log("[approvals] AgentDepositVault.topUp", amountUsdc6.toString());
  const tx = await vault.topUp(amountUsdc6);
  await tx.wait();
}

export async function runApprovalScaffold(signer) {
  await ensureUsdcVaultApproval(signer);
  await ensureAzlTreasuryApproval(signer);
  console.log("[approvals] USDC → AgentDepositVault and AZZLE → TreasuryRouter ready");
}

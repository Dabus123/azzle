import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const VAULT_ABI = ["function topUp(uint256 amount) external"];

/** Approve USDC for AgentDepositVault entry deposit ($25+). */
export async function ensureUsdcVaultApproval(signer, minAmount = 25_000_000n) {
  const wallet = await signer.getAddress();
  const usdc = new Contract(manifest.external.usdc, ERC20_ABI, signer);
  const allowance = await usdc.allowance(wallet, manifest.depositVault);
  if (allowance >= minAmount) return;
  console.log("[approvals] approving USDC for AgentDepositVault");
  const tx = await usdc.approve(manifest.depositVault, ethers.MaxUint256);
  await tx.wait();
}

/** Approve AZZLE for TreasuryRouter access fees (1,000 AZL per action). */
export async function ensureAzlTreasuryApproval(signer, minAmount = 1_000n * 10n ** 18n) {
  const wallet = await signer.getAddress();
  const azl = new Contract(manifest.external.azl, ERC20_ABI, signer);
  const allowance = await azl.allowance(wallet, manifest.treasuryRouter);
  if (allowance >= minAmount) return;
  console.log("[approvals] approving AZZLE for TreasuryRouter");
  const tx = await azl.approve(manifest.treasuryRouter, ethers.MaxUint256);
  await tx.wait();
}

export async function topUpVault(signer, amountUsdc6 = 25_000_000n) {
  await ensureUsdcVaultApproval(signer, amountUsdc6);
  const vault = new Contract(manifest.depositVault, VAULT_ABI, signer);
  console.log("[approvals] AgentDepositVault.topUp", amountUsdc6.toString());
  const tx = await vault.topUp(amountUsdc6);
  await tx.wait();
}

export async function runApprovalScaffold(signer) {
  await ensureUsdcVaultApproval(signer);
  await ensureAzlTreasuryApproval(signer);
  console.log("[approvals] USDC → AgentDepositVault and AZZLE → TreasuryRouter ready");
}

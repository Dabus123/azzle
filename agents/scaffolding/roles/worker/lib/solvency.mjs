import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

/** In-task solvency floor — protocol/AGENT_DEPOSITS.md */
export const MIN_TASK_BALANCE_USDC = 8_000_000n; // $8, 6 decimals

const VAULT_ABI = ["function balanceOf(address agent) external view returns (uint256)"];

export async function checkSolvency(provider, wallet) {
  const vault = new Contract(manifest.AgentDepositVault, VAULT_ABI, provider);
  const balance = (await vault.balanceOf(wallet)) as bigint;
  const ok = balance >= MIN_TASK_BALANCE_USDC;
  const warnings = [];
  if (!ok) {
    warnings.push(
      `AgentDepositVault ${balance} < ${MIN_TASK_BALANCE_USDC} ($8 USDC). Task may PAUSE — top up via AgentDepositVault.topUp.`
    );
  }
  return { balance, ok, warnings };
}

export async function warnIfBelowFloor(provider, wallet, label = "worker") {
  const { balance, ok, warnings } = await checkSolvency(provider, wallet);
  console.log(`[solvency:${label}] vault USDC (6dp)`, balance.toString());
  for (const w of warnings) {
    console.warn(`[solvency:${label}] WARNING: ${w}`);
  }
  return ok;
}

export function formatUsdc(raw) {
  return `$${(Number(raw) / 1e6).toFixed(2)}`;
}

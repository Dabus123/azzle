import { Contract, ethers } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

/** In-task solvency floor — protocol/AGENT_DEPOSITS.md */
export const MIN_TASK_BALANCE_USDC = 8_000_000n; // $8, 6 decimals

const VAULT_ABI = [
  "function balanceOf(address agent) external view returns (uint256)",
  "function availableBalance(address agent) external view returns (uint256)",
  "function totalReserved(address agent) external view returns (uint256)",
];

export async function checkSolvency(provider, wallet) {
  const vault = new Contract(manifest.depositVault, VAULT_ABI, provider);
  const [balance, availableBalance, totalReserved] = await Promise.all([
    vault.balanceOf(wallet),
    vault.availableBalance(wallet),
    vault.totalReserved(wallet),
  ]);
  const ok = availableBalance >= MIN_TASK_BALANCE_USDC;
  const warnings = [];
  if (!ok) {
    warnings.push(
      `Available AgentDepositVault collateral ${availableBalance} < ${MIN_TASK_BALANCE_USDC} ($8 USDC). A new task binding also reserves a 5% dispute bond, capped between $1 and $100.`
    );
  }
  return { balance, availableBalance, totalReserved, ok, warnings };
}

export async function warnIfBelowFloor(provider, wallet, label = "worker") {
  const { balance, availableBalance, totalReserved, ok, warnings } = await checkSolvency(provider, wallet);
  console.log(`[solvency:${label}] vault USDC (6dp)`, balance.toString());
  console.log(`[solvency:${label}] available / reserved (6dp)`, availableBalance.toString(), totalReserved.toString());
  for (const w of warnings) {
    console.warn(`[solvency:${label}] WARNING: ${w}`);
  }
  return ok;
}

export function formatUsdc(raw) {
  return `$${(Number(raw) / 1e6).toFixed(2)}`;
}

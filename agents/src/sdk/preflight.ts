import { Contract, ethers } from "ethers";

const VAULT_ABI = ["function balanceOf(address agent) external view returns (uint256)"];
const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function decimals() external view returns (uint8)",
];

export const MIN_VAULT_USDC = 20_000_000n; // $20, 6 decimals
export const MIN_AZL_ALLOWANCE = 1_000n * 10n ** 18n;
export const RECOMMENDED_AZL_BALANCE = 10_000n * 10n ** 18n;

export interface PreflightAddresses {
  agentDepositVault: string;
  treasuryRouter: string;
  azlToken: string;
  usdc: string;
}

export interface PreflightReport {
  wallet: string;
  vaultUsdc: bigint;
  walletUsdc: bigint;
  azlBalance: bigint;
  azlAllowance: bigint;
  vaultOk: boolean;
  azlAllowanceOk: boolean;
  warnings: string[];
}

export async function checkWorkerPreflight(
  provider: ethers.Provider,
  wallet: string,
  addresses: PreflightAddresses
): Promise<PreflightReport> {
  const vault = new Contract(addresses.agentDepositVault, VAULT_ABI, provider);
  const usdc = new Contract(addresses.usdc, ERC20_ABI, provider);
  const azl = new Contract(addresses.azlToken, ERC20_ABI, provider);

  const [vaultUsdc, walletUsdc, azlBalance, azlAllowance] = await Promise.all([
    vault.balanceOf(wallet) as Promise<bigint>,
    usdc.balanceOf(wallet) as Promise<bigint>,
    azl.balanceOf(wallet) as Promise<bigint>,
    azl.allowance(wallet, addresses.treasuryRouter) as Promise<bigint>,
  ]);

  const warnings: string[] = [];
  const vaultOk = vaultUsdc >= MIN_VAULT_USDC;
  const azlAllowanceOk = azlAllowance >= MIN_AZL_ALLOWANCE;

  if (!vaultOk) {
    warnings.push(
      `AgentDepositVault balance ${vaultUsdc} < ${MIN_VAULT_USDC} ($20 USDC). Top up before claim/post.`
    );
  }
  if (azlBalance < MIN_AZL_ALLOWANCE) {
    warnings.push(
      `Wallet AZL balance ${azlBalance} < ${MIN_AZL_ALLOWANCE} (1,000 AZL). Acquire AZL before fee-bearing actions.`
    );
  }
  if (!azlAllowanceOk) {
    warnings.push(
      `AZL allowance for TreasuryRouter ${azlAllowance} < ${MIN_AZL_ALLOWANCE}. Call azlToken.approve(treasuryRouter, amount).`
    );
  }
  if (walletUsdc < 25_000_000n) {
    warnings.push(`Wallet USDC ${walletUsdc} is below $25 recommended for fees + gas.`);
  }

  return {
    wallet,
    vaultUsdc,
    walletUsdc,
    azlBalance,
    azlAllowance,
    vaultOk,
    azlAllowanceOk,
    warnings,
  };
}

/** Approve TreasuryRouter for AZL if allowance is below the minimum (required before claim/post). */
export async function ensureAzlAllowance(
  signer: ethers.Signer,
  addresses: Pick<PreflightAddresses, "azlToken" | "treasuryRouter">,
  minAmount: bigint = MIN_AZL_ALLOWANCE
): Promise<void> {
  const wallet = await signer.getAddress();
  const azl = new Contract(addresses.azlToken, ERC20_ABI, signer);
  const allowance = (await azl.allowance(wallet, addresses.treasuryRouter)) as bigint;
  if (allowance >= minAmount) return;
  console.log("[preflight] approving AZL for TreasuryRouter");
  const tx = await azl.approve(addresses.treasuryRouter, ethers.MaxUint256);
  await tx.wait();
}

export function logPreflightReport(report: PreflightReport): void {
  console.log("[preflight] wallet", report.wallet);
  console.log("[preflight] vault USDC (6dp)", report.vaultUsdc.toString());
  console.log("[preflight] wallet USDC (6dp)", report.walletUsdc.toString());
  console.log("[preflight] AZL balance (wei)", report.azlBalance.toString());
  console.log("[preflight] AZL allowance → TreasuryRouter", report.azlAllowance.toString());
  for (const w of report.warnings) {
    console.warn(`[preflight] WARNING: ${w}`);
  }
  if (report.warnings.length === 0) {
    console.log("[preflight] wallet ready for fee-bearing actions");
  }
}

/**
 * Read-only retirement check for the old suite.
 * Proves enumerable aggregate state where available and explicitly lists
 * mapping-backed liabilities that cannot be exhaustively enumerated onchain.
 */
import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";
import { validateManifestSchema } from "./suite-manifest";

const DEFAULT_MANIFEST = path.join(__dirname, "..", "deployments", "base-8453.json");

async function main() {
  const manifestPath = process.env.OLD_SUITE_MANIFEST?.trim()
    ? path.resolve(process.cwd(), process.env.OLD_SUITE_MANIFEST)
    : DEFAULT_MANIFEST;
  const d = validateManifestSchema(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const network = await ethers.provider.getNetwork();
  if (network.chainId.toString() !== d.chainId) {
    throw new Error(`Connected chain ${network.chainId}, manifest chain ${d.chainId}`);
  }

  const registry = await ethers.getContractAt("TaskRegistry", d.TaskRegistry);
  const arbitration = await ethers.getContractAt("ArbitrationModule", d.ArbitrationModule);
  const escrow = await ethers.getContractAt("EscrowVault", d.EscrowVault);
  const vault = await ethers.getContractAt("AgentDepositVault", d.AgentDepositVault);
  const treasury = await ethers.getContractAt("TreasuryRouter", d.TreasuryRouter);
  const staking = await ethers.getContractAt("UnionStakingVault", d.UnionStakingVault);
  const usdc = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    d.usdc
  );
  const azl = await ethers.getContractAt(
    ["function balanceOf(address) view returns (uint256)"],
    d.azlToken
  );

  const values: Array<[string, bigint]> = [
    ["ArbitrationModule.activeDisputeCount", await arbitration.activeDisputeCount()],
    ["ArbitrationModule.pendingSideEffectCount", await arbitration.pendingSideEffectCount()],
    ["AgentDepositVault.totalDeposits", await vault.totalDeposits()],
    ["AgentDepositVault.totalPendingPayouts", await vault.totalPendingPayouts()],
    ["UnionStakingVault.totalStaked", await staking.totalStaked()],
    ["TreasuryRouter.pendingUsdcRevenue", await treasury.pendingUsdcRevenue()],
    ["TreasuryRouter.pendingStakerUsdc", await treasury.pendingStakerUsdc()],
    ["TreasuryRouter.pendingBuybackUsdc", await treasury.pendingBuybackUsdc()],
    ["TreasuryRouter.usdcReserve", await treasury.usdcReserve()],
    ["TreasuryRouter.accruedNative", await treasury.accruedNative()],
    ["EscrowVault USDC token balance", await usdc.balanceOf(d.EscrowVault)],
    ["AgentDepositVault USDC token balance", await usdc.balanceOf(d.AgentDepositVault)],
    ["TreasuryRouter USDC token balance", await usdc.balanceOf(d.TreasuryRouter)],
    ["UnionStakingVault USDC token balance", await usdc.balanceOf(d.UnionStakingVault)],
    ["UnionStakingVault AZL token balance", await azl.balanceOf(d.UnionStakingVault)],
  ];

  let nonzero = 0;
  console.log(`[old-suite] ${manifestPath}`);
  const taskCount = await registry.taskCount();
  let liveTasks = 0n;
  let lockedEscrows = 0n;
  for (let taskId = 1n; taskId <= taskCount; taskId += 1n) {
    const state = Number(await registry.taskState(taskId));
    // Terminal states: COMPLETED, CANCELLED, EXPIRED, RESOLVED, DELETED.
    if (![5, 6, 7, 9, 12].includes(state)) liveTasks += 1n;
    if ((await escrow.lockedBalance(taskId)) !== 0n) lockedEscrows += 1n;
  }
  values.unshift(
    ["TaskRegistry non-terminal tasks (enumerated)", liveTasks],
    ["EscrowVault task records with locked balance (enumerated)", lockedEscrows]
  );
  for (const [label, value] of values) {
    console.log(`${value === 0n ? "✓" : "✗"} ${label}: ${value}`);
    if (value !== 0n) nonzero += 1;
  }

  console.log("\nNon-enumerable limitations (cannot prove global zero from contract getters):");
  console.log("- EscrowVault escrows and per-token/per-recipient pendingPayouts mappings");
  console.log("- AgentDepositVault per-agent deposits/reservations beyond aggregate counters");
  console.log("- TreasuryRouter accruedFees(address) for arbitrary token addresses");
  console.log("- ArbitrationModule pendingBondPayouts(address) for arbitrary recipients");
  console.log("- UnionStakingVault per-staker pending USDC/credits (totalStaked is enumerable)");
  console.log(
    "Use indexed events and known participant/token address lists to close these gaps before retirement."
  );

  if (nonzero > 0) throw new Error(`${nonzero} enumerable old-suite value(s) are nonzero`);
  console.log("\nEnumerable checks are zero; this is not a proof that non-enumerable mappings are empty.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

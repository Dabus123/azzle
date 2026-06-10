import { Contract, ethers } from "ethers";
import { AzzleClient, checkWorkerPreflight, logPreflightReport } from "@azzle/agents";
import { loadManifest } from "./lib/manifest.mjs";

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { guardRegistrationCooldown } from "./lib/cooldown.mjs";
import { checkTierEligibility, tierForAmountUsdc6, workerBpsSplit } from "./lib/tiers.mjs";
import { runResolutionWatchdog } from "./lib/watchdog.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

const REPUTATION_ABI = [
  "function arbitratorReputation(address) external view returns (uint256)",
  "function resolvedCount(address) external view returns (uint256)",
];

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
}

function connectClient(signer) {
  return new AzzleClient({
    rpcUrl,
    registryAddress: manifest.TaskRegistry,
    escrowAddress: manifest.EscrowVault,
    arbitrationAddress: manifest.ArbitrationModule,
  }).connect(signer);
}

async function readArbitratorStats(provider, wallet) {
  const rep = new Contract(manifest.ReputationRegistry, REPUTATION_ABI, provider);
  const [arbitratorRep, resolvedCount] = await Promise.all([
    rep.arbitratorReputation(wallet),
    rep.resolvedCount(wallet),
  ]);
  return { rep: Number(arbitratorRep), resolvedCount: Number(resolvedCount) };
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.AgentDepositVault,
    treasuryRouter: manifest.TreasuryRouter,
    azlToken: manifest.azlToken,
    usdc: manifest.usdc,
  });
  logPreflightReport(report);
  const stats = await readArbitratorStats(signer.provider, wallet);
  console.log("[arbitrator] reputation", stats);
  for (const tier of [0, 1, 2]) {
    const { eligible, reasons, gate } = checkTierEligibility(tier, {
      rep: stats.rep,
      resolvedCount: stats.resolvedCount,
      hasDeposit: report.vaultOk,
    });
    console.log(`[arbitrator] ${gate.label}:`, eligible ? "eligible" : reasons.join("; "));
  }
}

async function registerStandby(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: npm run register -- <taskId>");

  const signer = requireSigner();
  const wallet = await signer.getAddress();
  await guardRegistrationCooldown(signer.provider, wallet);

  const client = connectClient(signer);
  console.log("[arbitrator] registerArbitrator (standby +10 rep)", taskId.toString());
  const tx = await client.registerArbitrator(taskId);
  await tx.wait();
}

async function proposeFlow(disputeIdArg, arbitratorArg) {
  const disputeId = BigInt(disputeIdArg ?? process.env.DISPUTE_ID ?? "0");
  const arbitrator = arbitratorArg ?? process.env.ARBITRATOR_ADDRESS ?? (await requireSigner().getAddress());
  if (disputeId === 0n) throw new Error("Usage: node agent.mjs propose <disputeId> [arbitrator]");

  const client = connectClient(requireSigner());
  console.log("[arbitrator] proposeArbitrator — both parties must call with same address");
  const tx = await client.proposeArbitrator(disputeId, arbitrator);
  await tx.wait();
}

async function resolveFlow(disputeIdArg, workerPercentArg) {
  const disputeId = BigInt(disputeIdArg ?? process.env.DISPUTE_ID ?? "0");
  const workerPercent = Number(workerPercentArg ?? process.env.WORKER_PERCENT ?? "50");
  if (disputeId === 0n) throw new Error("Usage: npm run resolve -- <disputeId> [workerPercent]");

  const client = connectClient(requireSigner());
  const workerBps = workerBpsSplit(workerPercent);
  console.log("[arbitrator] resolveDispute", { disputeId: disputeId.toString(), workerBps });
  const tx = await client.resolveDispute(disputeId, workerBps);
  await tx.wait();
}

async function watchdogFlow(disputeIdArg) {
  const disputeId = BigInt(disputeIdArg ?? process.env.DISPUTE_ID ?? "0");
  if (disputeId === 0n) throw new Error("Usage: npm run watchdog -- <disputeId>");
  const signer = requireSigner();
  const client = connectClient(signer);
  await runResolutionWatchdog(client, signer.provider, disputeId);
}

async function tierCheck(amountArg) {
  const amount = BigInt(amountArg ?? "50000000");
  const tier = tierForAmountUsdc6(amount);
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const stats = await readArbitratorStats(signer.provider, wallet);
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.AgentDepositVault,
    treasuryRouter: manifest.TreasuryRouter,
    azlToken: manifest.azlToken,
    usdc: manifest.usdc,
  });
  const result = checkTierEligibility(tier, {
    rep: stats.rep,
    resolvedCount: stats.resolvedCount,
    hasDeposit: report.vaultOk,
  });
  console.log("[arbitrator] tier check", { tier, amount: amount.toString(), ...result });
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  const a = process.argv[3];
  const b = process.argv[4];

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "register") {
    await registerStandby(a);
    return;
  }
  if (cmd === "propose") {
    await proposeFlow(a, b);
    return;
  }
  if (cmd === "resolve") {
    await resolveFlow(a, b);
    return;
  }
  if (cmd === "watchdog") {
    await watchdogFlow(a);
    return;
  }
  if (cmd === "tier-check") {
    await tierCheck(a);
    return;
  }

  console.log(`AZZLE arbitrator agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight              # deposit + tier eligibility");
  console.log("  npm run register -- <taskId>   # standby farming (+10 rep)");
  console.log("  node agent.mjs propose <disputeId> [arbitrator]");
  console.log("  npm run resolve -- <disputeId> [workerPercent]");
  console.log("  npm run watchdog -- <disputeId> # 7-day RESOLUTION_TIMEOUT");
  console.log("  node agent.mjs tier-check [amountUsdc6]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

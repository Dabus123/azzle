import { ethers } from "ethers";
import {
  AzzleClient,
  buildSettlementDigest,
  checkWorkerPreflight,
  logPreflightReport,
} from "@azzle/agents";
import { loadManifest } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { runApprovalScaffold } from "./lib/approvals.mjs";
import { acceptMilestone, fundTaskEscrow, openDispute } from "./lib/escrow.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

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

function sampleTerms(poster, worker = ethers.ZeroAddress) {
  const acceptanceCriteriaHash = ethers.id("azzle-demo-criteria");
  return {
    poster,
    worker,
    token: manifest.usdc,
    totalAmount: 50_000_000n, // $50 USDC
    escrowMode: "milestone",
    milestoneAmounts: [50_000_000n],
    deadline: BigInt(Math.floor(Date.now() / 1000) + 7 * 86400),
    acceptanceCriteriaHash,
    replacementAllowed: true,
  };
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  await runApprovalScaffold(signer);
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.AgentDepositVault,
    treasuryRouter: manifest.TreasuryRouter,
    azlToken: manifest.azlToken,
    usdc: manifest.usdc,
  });
  logPreflightReport(report);
}

async function postTaskFlow(mode = "market") {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);
  await runApprovalScaffold(signer);

  const worker = process.env.WORKER_ADDRESS?.trim();
  const terms = sampleTerms(wallet, worker ? worker : ethers.ZeroAddress);
  const digest = buildSettlementDigest(terms);
  console.log("[poster] settlement digest", digest);

  let result;
  if (mode === "direct" || worker) {
    if (!worker) throw new Error("Direct hire requires WORKER_ADDRESS in .env");
    terms.worker = worker;
    console.log("[poster] createTask (direct hire)", worker);
    result = await client.createTask({ ...terms, worker });
  } else {
    console.log("[poster] postTask (search market)");
    result = await client.postTask(terms);
  }

  console.log("[poster] task created", { taskId: result.taskId.toString(), digest: result.digest });

  const fundAmount = terms.totalAmount;
  await fundTaskEscrow(client, signer, result.taskId, fundAmount);

  console.log("[poster] handlers wired:");
  console.log("  acceptMilestone(taskId, 0) — release milestone to worker");
  console.log("  openDispute(taskId, evidenceHash) — freeze escrow, enter arbitration");

  return result;
}

async function fundOnly(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: npm run fund -- <taskId>");
  const signer = requireSigner();
  const client = connectClient(signer);
  const amount = BigInt(process.env.FUND_AMOUNT ?? "50000000");
  await fundTaskEscrow(client, signer, taskId, amount);
}

async function main() {
  const cmd = process.argv[2] ?? "help";
  const sub = process.argv[3];

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "post") {
    const mode = sub === "direct" ? "direct" : "market";
    await postTaskFlow(mode);
    return;
  }
  if (cmd === "fund") {
    await fundOnly(sub);
    return;
  }
  if (cmd === "accept") {
    const taskId = BigInt(sub ?? process.env.TASK_ID ?? "0");
    const client = connectClient(requireSigner());
    await acceptMilestone(client, taskId, 0);
    return;
  }
  if (cmd === "dispute") {
    const taskId = BigInt(sub ?? process.env.TASK_ID ?? "0");
    const client = connectClient(requireSigner());
    await openDispute(client, taskId, process.env.EVIDENCE_HASH ?? ethers.id("dispute-evidence"));
    return;
  }

  console.log(`AZZLE poster agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight          # approvals + deposit checklist");
  console.log("  npm run post               # postTask (search market)");
  console.log("  node agent.mjs post direct # createTask (direct hire + WORKER_ADDRESS)");
  console.log("  npm run fund -- <taskId>   # fundTask → EscrowVault");
  console.log("  node agent.mjs accept <taskId>");
  console.log("  node agent.mjs dispute <taskId>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

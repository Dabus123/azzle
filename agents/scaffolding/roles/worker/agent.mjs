import { ethers } from "ethers";
import {
  AzzleClient,
  BaseRpcIndexer,
  buildExecutionReceipt,
  checkWorkerPreflight,
  ensureAzlAllowance,
  logPreflightReport,
} from "@azzle/agents";
import { loadManifest } from "./lib/manifest.mjs";
import { loadDotEnv } from "./lib/env.mjs";

loadDotEnv(import.meta.url);

const manifest = loadManifest(import.meta.url, "base-8453.json");
import { warnIfBelowFloor } from "./lib/solvency.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk, provider);
}

function connectClient(signer) {
  return new AzzleClient({
    rpcUrl,
    registryAddress: manifest.TaskRegistry,
    escrowAddress: manifest.EscrowVault,
    arbitrationAddress: manifest.ArbitrationModule,
  }).connect(signer);
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
  await warnIfBelowFloor(signer.provider, wallet);
}

async function listOpen() {
  const indexer = new BaseRpcIndexer({ rpcUrl });
  const tasks = await indexer.getOpenTasks();
  console.log(JSON.stringify({ count: tasks.length, tasks }, null, 2));
}

async function claimFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: npm run claim -- <taskId> or set TASK_ID");

  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);

  await runPreflightChecks(signer, wallet);
  await warnIfBelowFloor(signer.provider, wallet);

  const { createNegotiationLayer } = await import("./lib/xmtp-setup.mjs");
  const { transport } = await createNegotiationLayer(signer);
  transport.subscribe?.((msg) => console.log("[xmtp] envelope", msg.type, msg.taskId));

  console.log("[worker] claiming task", taskId.toString());
  const claimTx = await client.claimTask(taskId);
  await claimTx.wait();

  const deliverableHash = ethers.keccak256(
    ethers.toUtf8Bytes(`azzle-worker:${taskId}:${Date.now()}`)
  );
  const receipt = buildExecutionReceipt({
    taskId: taskId.toString(),
    milestoneIndex: 0,
    worker: wallet,
    artifacts: [{ type: "deterministic_output", hash: deliverableHash, uri: "ipfs://stub" }],
  });

  console.log("[worker] submitting proof", receipt.receiptHash);
  const proofTx = await client.submitProof(taskId, 0, receipt.receiptHash);
  await proofTx.wait();

  console.log("[worker] awaiting poster acceptMilestone — monitor via Base RPC or XMTP DeliveryNotice ack");
  return receipt;
}

async function runPreflightChecks(signer, wallet) {
  await ensureAzlAllowance(signer, {
    azlToken: manifest.azlToken,
    treasuryRouter: manifest.TreasuryRouter,
  });
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.AgentDepositVault,
    treasuryRouter: manifest.TreasuryRouter,
    azlToken: manifest.azlToken,
    usdc: manifest.usdc,
  });
  if (report.warnings.length) {
    for (const w of report.warnings) console.warn("[preflight]", w);
  }
}

async function main() {
  const cmd = process.argv[2] ?? "help";

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "list-open") {
    await listOpen();
    return;
  }
  if (cmd === "claim") {
    await claimFlow(process.argv[3]);
    return;
  }

  console.log(`AZZLE worker agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight   # USDC ≥ $25, vault, AZL approval checks");
  console.log("  npm run list-open   # POSTED tasks from Base RPC");
  console.log("  npm run claim -- <taskId>");
  console.log("");
  console.log("Flow: claimTask → buildExecutionReceipt → submitProof → poster acceptMilestone");
  console.log("Set USE_XMTP_LIVE=true for XmtpNegotiationTransport (default: NegotiationBus)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

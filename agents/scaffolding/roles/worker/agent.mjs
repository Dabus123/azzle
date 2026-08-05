import { ethers } from "ethers";
import {
  AzzleClient,
  RpcDiscovery,
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

const TASK_STATE = { ACTIVE: 3, IN_REVIEW: 4 };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * submitProof reverts until the poster funds escrow (lockedBalance > 0) and
 * calls startWork (state ACTIVE). Poll for both with a bounded timeout.
 */
async function waitForFundedActive(client, taskId, options = {}) {
  const timeoutMs = options.timeoutMs ?? Number(process.env.WORKER_FUND_TIMEOUT_MS ?? 600_000);
  const pollMs = options.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    const [state, locked] = await Promise.all([
      client.taskState(taskId),
      client.lockedBalance(taskId),
    ]);
    const funded = locked > 0n;
    if (funded && (state === TASK_STATE.ACTIVE || state === TASK_STATE.IN_REVIEW)) {
      console.log("[worker] task funded + ACTIVE", {
        taskId: taskId.toString(),
        lockedBalance: locked.toString(),
      });
      return true;
    }
    if (!announced) {
      announced = true;
      console.log(
        `[worker] waiting for poster to fundTask(${taskId}) and startWork(${taskId}) ` +
          `(state ${state}, locked ${locked}) — timeout ${Math.round(timeoutMs / 1000)}s`
      );
    }
    if (Date.now() >= deadline) {
      console.error(
        `[worker] task ${taskId} not funded/ACTIVE within ${Math.round(timeoutMs / 1000)}s — ` +
          `ask the poster to call fundTask + startWork, then run: node agent.mjs prove ${taskId}`
      );
      return false;
    }
    await sleep(pollMs);
  }
}

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  return new ethers.Wallet(pk, provider);
}

function connectClient(signer) {
  return new AzzleClient({
    rpcUrl,
    registryAddress: manifest.taskRegistry,
    escrowAddress: manifest.escrowVault,
    arbitrationAddress: manifest.arbitrationModule,
  }).connect(signer);
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    treasuryRouter: manifest.treasuryRouter,
    azlToken: manifest.external.azl,
    usdc: manifest.external.usdc,
  });
  logPreflightReport(report);
  await warnIfBelowFloor(signer.provider, wallet);
}

async function listOpen() {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org" });
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

  return submitProofFlow(client, taskId, wallet);
}

async function acceptDirectHireFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: node agent.mjs accept-direct <taskId>");
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);
  await runPreflightChecks(signer, wallet);
  console.log("[worker] accepting direct-hire invitation", taskId.toString());
  const tx = await client.acceptDirectHire(taskId);
  await tx.wait();
  return submitProofFlow(client, taskId, wallet);
}

async function declineDirectHireFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: node agent.mjs decline-direct <taskId>");
  const client = connectClient(requireSigner());
  console.log("[worker] declining direct-hire invitation", taskId.toString());
  const tx = await client.declineDirectHire(taskId);
  await tx.wait();
  console.log("[worker] invitation terminated as EXPIRED; poster must create a new task to re-invite");
}

async function submitProofFlow(client, taskId, wallet) {
  const ready = await waitForFundedActive(client, taskId);
  if (!ready) return null;

  const deliverableHash = ethers.keccak256(
    ethers.toUtf8Bytes(`azzle-worker:${taskId}:${Date.now()}`)
  );
  const receipt = buildExecutionReceipt({
    taskId: taskId.toString(),
    milestoneIndex: 0,
    worker: wallet,
    artifacts: [{ type: "deterministic_output", hash: deliverableHash }],
  });

  console.log("[worker] submitting proof", receipt.receiptHash);
  const proofTx = await client.submitProof(taskId, 0, receipt.receiptHash);
  await proofTx.wait();

  console.log("[worker] awaiting poster release — monitor via Base RPC or XMTP DeliveryNotice ack");
  return receipt;
}

async function proveFlow(taskIdArg) {
  const taskId = BigInt(taskIdArg ?? process.env.TASK_ID ?? "0");
  if (taskId === 0n) throw new Error("Usage: node agent.mjs prove <taskId>");
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const client = connectClient(signer);
  return submitProofFlow(client, taskId, wallet);
}

async function runPreflightChecks(signer, wallet) {
  await ensureAzlAllowance(signer, {
    azlToken: manifest.external.azl,
    treasuryRouter: manifest.treasuryRouter,
  });
  const report = await checkWorkerPreflight(signer.provider, wallet, {
    agentDepositVault: manifest.depositVault,
    treasuryRouter: manifest.treasuryRouter,
    azlToken: manifest.external.azl,
    usdc: manifest.external.usdc,
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
  if (cmd === "accept-direct") {
    await acceptDirectHireFlow(process.argv[3]);
    return;
  }
  if (cmd === "decline-direct") {
    await declineDirectHireFlow(process.argv[3]);
    return;
  }
  if (cmd === "prove") {
    await proveFlow(process.argv[3]);
    return;
  }

  console.log(`AZZLE worker agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight   # USDC ≥ $25, vault, AZL approval checks");
  console.log("  npm run list-open   # POSTED tasks from Base RPC");
  console.log("  npm run claim -- <taskId>");
  console.log("  node agent.mjs accept-direct <taskId>  # invited worker activates direct hire");
  console.log("  node agent.mjs decline-direct <taskId> # terminate invitation as EXPIRED");
  console.log("  node agent.mjs prove <taskId>  # retry proof after poster funds + starts");
  console.log("");
  console.log("Flow: claimTask → wait fundTask+startWork → buildExecutionReceipt → submitProof → poster acceptMilestone");
  console.log("Set USE_XMTP_LIVE=true for XmtpNegotiationTransport (default: NegotiationBus)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

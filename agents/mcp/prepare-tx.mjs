#!/usr/bin/env node
/**
 * Prepare unsigned AZZLE calldata batches for Base MCP send_calls.
 *
 * Prerequisite: cd agents && npm run build
 *
 *   npm run mcp:prepare -- read --from 0x...
 *   npm run mcp:prepare -- onboarding --from 0x... --top-up-amount 50000000
 *   npm run mcp:prepare -- claim-task --from 0x... --task-id 42
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTaskTerms,
} from "./terms-utils.mjs";
import { buildExecutionReceipt } from "../dist/sdk/receipt.js";
import { buildTaskTermsBundle } from "./xmtp-helpers.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "../deployments/base-8453.json"), "utf8")
);

const CHAIN_ID = 8453;
const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const MIN_VAULT_USDC = 20_000_000n;
const MIN_AZL_ALLOWANCE = 1_000n * 10n ** 18n;
const MAX_UINT256 = ethers.MaxUint256;

const ERC20_IFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
]);
const VAULT_IFACE = new ethers.Interface([
  "function topUp(uint256 amount)",
  "function balanceOf(address agent) view returns (uint256)",
]);
const REGISTRY_IFACE = new ethers.Interface([
  "function createTask(address worker, address token, uint256 totalAmount, uint8 escrowMode, bytes32 settlementDigest, uint256 deadline, bool replacementAllowed, uint256[] milestoneAmounts, uint256 streamRate, uint256 hourBlockSize) returns (uint256)",
  "function postTask(address token, uint256 totalAmount, uint8 escrowMode, bytes32 settlementDigest, uint256 deadline, uint256[] milestoneAmounts, uint256 streamRate, uint256 hourBlockSize) returns (uint256)",
  "function claimTask(uint256 taskId)",
  "function startWork(uint256 taskId)",
  "function fundTask(uint256 taskId, uint256 amount)",
  "function submitProof(uint256 taskId, uint256 milestoneIndex, bytes32 receiptHash)",
  "function acceptMilestone(uint256 taskId, uint256 milestoneIndex)",
  "function leaveTask(uint256 taskId)",
  "function dismissWorker(uint256 taskId)",
  "function emergencyTopUp(uint256 taskId, uint256 amount)",
  "function completeTask(uint256 taskId)",
  "function openDispute(uint256 taskId, bytes evidenceHash)",
]);

const ARBITRATION_IFACE = new ethers.Interface([
  "function registerArbitrator(uint256 taskId)",
  "function proposeArbitrator(uint256 disputeId, address arbitrator)",
  "function resolveDispute(uint256 disputeId, uint256 workerBps)",
  "function resolveTimedOut(uint256 disputeId)",
  "function escalate(uint256 disputeId)",
]);

const ESCROW_MODE = { upfront: 0, milestone: 1, streaming: 2, hour_blocks: 3 };

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2).replace(/-/g, "_");
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function tx(step, to, data, value = "0x0") {
  return { step, to, data, value, chainId: CHAIN_ID };
}

function encodeApprove(token, spender, amount) {
  return ERC20_IFACE.encodeFunctionData("approve", [spender, amount]);
}

function output(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function fail(message) {
  output({ ok: false, error: message });
  process.exit(1);
}

function requireFrom(flags) {
  const from = flags.from;
  if (!from || !ethers.isAddress(from)) {
    fail("--from <0x address> is required");
  }
  return ethers.getAddress(from);
}

async function readAllowances(from) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const usdc = new ethers.Contract(manifest.usdc, ERC20_IFACE, provider);
  const azl = new ethers.Contract(manifest.azlToken, ERC20_IFACE, provider);
  const vault = new ethers.Contract(manifest.AgentDepositVault, VAULT_IFACE, provider);

  const [vaultUsdc, walletUsdc, azlBalance, azlAllowance, usdcAllowanceVault, usdcAllowanceRegistry] =
    await Promise.all([
      vault.balanceOf(from),
      usdc.balanceOf(from),
      azl.balanceOf(from),
      azl.allowance(from, manifest.TreasuryRouter),
      usdc.allowance(from, manifest.AgentDepositVault),
      usdc.allowance(from, manifest.TaskRegistry),
    ]);

  return {
    vaultUsdc,
    walletUsdc,
    azlBalance,
    azlAllowance,
    usdcAllowanceVault,
    usdcAllowanceRegistry,
  };
}

async function maybeAzlApprove(from, transactions) {
  const { azlAllowance } = await readAllowances(from);
  if (azlAllowance >= MIN_AZL_ALLOWANCE) return;
  transactions.push(
    tx(
      "approve-azl",
      manifest.azlToken,
      encodeApprove(manifest.azlToken, manifest.TreasuryRouter, MAX_UINT256)
    )
  );
}

async function maybeUsdcApproveRegistry(from, amount, transactions) {
  const { usdcAllowanceRegistry } = await readAllowances(from);
  if (usdcAllowanceRegistry >= BigInt(amount)) return;
  transactions.push(
    tx(
      "approve-usdc-registry",
      manifest.usdc,
      encodeApprove(manifest.usdc, manifest.TaskRegistry, MAX_UINT256)
    )
  );
}

function encodeDisputeEvidence(raw) {
  if (raw.length === 66 && raw.startsWith("0x")) {
    return ethers.getBytes(raw);
  }
  return ethers.getBytes(ethers.id(raw));
}

async function maybeUsdcApproveVault(from, amount, transactions) {
  const { usdcAllowanceVault } = await readAllowances(from);
  if (usdcAllowanceVault >= BigInt(amount)) return;
  transactions.push(
    tx(
      "approve-usdc-vault",
      manifest.usdc,
      encodeApprove(manifest.usdc, manifest.AgentDepositVault, MAX_UINT256)
    )
  );
}

function batchResponse(action, transactions) {
  return { ok: true, action, chainId: CHAIN_ID, transactions };
}

async function cmdRead(from) {
  const state = await readAllowances(from);
  const warnings = [];
  if (state.vaultUsdc < MIN_VAULT_USDC) {
    warnings.push(
      `AgentDepositVault ${state.vaultUsdc} < ${MIN_VAULT_USDC} ($20 USDC minimum for post/claim).`
    );
  }
  if (state.azlBalance < MIN_AZL_ALLOWANCE) {
    warnings.push(`Wallet AZL ${state.azlBalance} < 1000 AZZLE for access fees.`);
  }
  if (state.azlAllowance < MIN_AZL_ALLOWANCE) {
    warnings.push("AZL not approved for TreasuryRouter.");
  }

  output({
    ok: true,
    action: "read",
    chainId: CHAIN_ID,
    wallet: from,
    manifest: {
      TaskRegistry: manifest.TaskRegistry,
      AgentDepositVault: manifest.AgentDepositVault,
      TreasuryRouter: manifest.TreasuryRouter,
      usdc: manifest.usdc,
      azlToken: manifest.azlToken,
    },
    balances: {
      vaultUsdc: state.vaultUsdc.toString(),
      walletUsdc: state.walletUsdc.toString(),
      azlBalanceWei: state.azlBalance.toString(),
      azlAllowanceRouter: state.azlAllowance.toString(),
      usdcAllowanceVault: state.usdcAllowanceVault.toString(),
      usdcAllowanceRegistry: state.usdcAllowanceRegistry.toString(),
    },
    warnings,
    readyForFeeActions:
      state.vaultUsdc >= MIN_VAULT_USDC &&
      state.azlBalance >= MIN_AZL_ALLOWANCE &&
      state.azlAllowance >= MIN_AZL_ALLOWANCE,
  });
}

async function cmdOnboarding(from, flags) {
  const topUpAmount = BigInt(flags.top_up_amount ?? "50000000");
  const transactions = [];
  await maybeUsdcApproveVault(from, topUpAmount, transactions);
  await maybeAzlApprove(from, transactions);
  transactions.push(
    tx(
      "top-up",
      manifest.AgentDepositVault,
      VAULT_IFACE.encodeFunctionData("topUp", [topUpAmount])
    )
  );
  output(batchResponse("onboarding", transactions));
}

async function cmdApproveUsdcVault(from) {
  output(
    batchResponse("approve-usdc-vault", [
      tx(
        "approve-usdc-vault",
        manifest.usdc,
        encodeApprove(manifest.usdc, manifest.AgentDepositVault, MAX_UINT256)
      ),
    ])
  );
}

async function cmdApproveAzlRouter(from) {
  output(
    batchResponse("approve-azl-router", [
      tx(
        "approve-azl-router",
        manifest.azlToken,
        encodeApprove(manifest.azlToken, manifest.TreasuryRouter, MAX_UINT256)
      ),
    ])
  );
}

async function cmdTopUp(from, flags) {
  const amount = BigInt(flags.amount ?? fail("--amount required (USDC 6 decimals)"));
  const transactions = [];
  await maybeUsdcApproveVault(from, amount, transactions);
  transactions.push(
    tx(
      "top-up",
      manifest.AgentDepositVault,
      VAULT_IFACE.encodeFunctionData("topUp", [amount])
    )
  );
  output(batchResponse("top-up", transactions));
}

async function cmdClaimTask(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const transactions = [];
  if (flags.skip_approvals !== "true") {
    await maybeAzlApprove(from, transactions);
  }
  transactions.push(
    tx(
      "claim-task",
      manifest.TaskRegistry,
      REGISTRY_IFACE.encodeFunctionData("claimTask", [taskId])
    )
  );
  output(batchResponse("claim-task", transactions));
}

function parseTaskTermsFromFlags(from, flags, options = {}) {
  return parseTaskTerms(from, flags, manifest, { ...options, fail });
}

async function cmdCreateTask(from, flags) {
  const parsed = parseTaskTermsFromFlags(from, flags, { requireWorker: true });
  output(
    batchResponse("create-task", [
      tx(
        "create-task",
        manifest.TaskRegistry,
        REGISTRY_IFACE.encodeFunctionData("createTask", [
          parsed.terms.worker,
          manifest.usdc,
          parsed.terms.totalAmount,
          ESCROW_MODE[parsed.terms.escrowMode] ?? 1,
          parsed.digest,
          parsed.terms.deadline,
          parsed.terms.replacementAllowed,
          parsed.terms.milestoneAmounts,
          parsed.streamRate,
          parsed.hourBlockSize,
        ])
      ),
    ])
  );
}

async function cmdPostTask(from, flags) {
  const parsed = parseTaskTermsFromFlags(from, flags);
  const transactions = [];
  if (flags.skip_approvals !== "true") {
    await maybeAzlApprove(from, transactions);
  }
  transactions.push(
    tx(
      "post-task",
      manifest.TaskRegistry,
      REGISTRY_IFACE.encodeFunctionData("postTask", [
        manifest.usdc,
        parsed.terms.totalAmount,
        ESCROW_MODE[parsed.terms.escrowMode] ?? 1,
        parsed.digest,
        parsed.terms.deadline,
        parsed.terms.milestoneAmounts,
        parsed.streamRate,
        parsed.hourBlockSize,
      ])
    )
  );
  output({ ...batchResponse("post-task", transactions), warnings: parsed.warnings });
}

function cmdArbitration(action, fn, extraArgs) {
  output(
    batchResponse(action, [
      tx(action, manifest.ArbitrationModule, ARBITRATION_IFACE.encodeFunctionData(fn, extraArgs)),
    ])
  );
}

async function cmdFundTask(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const amount = BigInt(flags.amount ?? fail("--amount required"));
  const transactions = [];
  if (flags.skip_approvals !== "true") {
    await maybeUsdcApproveRegistry(from, amount, transactions);
  }
  transactions.push(
    tx(
      "fund-task",
      manifest.TaskRegistry,
      REGISTRY_IFACE.encodeFunctionData("fundTask", [taskId, amount])
    )
  );
  output(batchResponse("fund-task", transactions));
}

async function cmdOpenDispute(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const evidence = flags.evidence ?? flags.evidence_hash ?? "dispute-evidence";
  output(
    batchResponse("open-dispute", [
      tx(
        "open-dispute",
        manifest.TaskRegistry,
        REGISTRY_IFACE.encodeFunctionData("openDispute", [taskId, encodeDisputeEvidence(evidence)])
      ),
    ])
  );
}

function cmdHashCriteria(flags) {
  const text = flags.text ?? flags.criteria ?? fail("--text required");
  output({
    ok: true,
    action: "hash-criteria",
    text,
    acceptanceCriteriaHash: ethers.id(text),
  });
}

function cmdPrepareReceipt(flags) {
  const taskId = String(flags.task_id ?? fail("--task-id required"));
  const worker = flags.worker ?? fail("--worker required");
  if (!ethers.isAddress(worker)) fail("--worker must be a valid address");
  const milestoneIndex = Number(flags.milestone_index ?? "0");
  const artifactType = flags.artifact_type ?? "deliverable";
  const artifactHash = flags.artifact_hash ?? fail("--artifact-hash required");
  const artifact = { type: artifactType, hash: artifactHash };
  if (flags.artifact_uri) artifact.uri = flags.artifact_uri;
  const receipt = buildExecutionReceipt({
    taskId,
    milestoneIndex,
    worker: ethers.getAddress(worker),
    artifacts: [artifact],
  });
  output({ ok: true, action: "prepare-receipt", receipt });
}

async function cmdRegistryCall(action, fn, flags, extraArgs = [], { accessFee = false } = {}) {
  const from = requireFrom(flags);
  const transactions = [];
  if (accessFee && flags.skip_approvals !== "true") {
    await maybeAzlApprove(from, transactions);
  }
  transactions.push(tx(action, manifest.TaskRegistry, REGISTRY_IFACE.encodeFunctionData(fn, extraArgs)));
  output(batchResponse(action, transactions));
}

function usage() {
  return `Usage (from agents/): npm run mcp:prepare -- <action> [flags]
       (direct):          node mcp/prepare-tx.mjs <action> [flags]

Actions:
  read                         Wallet + vault preflight (read-only JSON)
  onboarding                   approve USDC/AZL (if needed) + topUp
  approve-usdc-vault           ERC20 approve USDC → AgentDepositVault
  approve-azl-router           ERC20 approve AZZLE → TreasuryRouter
  top-up                       AgentDepositVault.topUp
  claim-task                   TaskRegistry.claimTask (+ AZL approve if needed)
  post-task                    TaskRegistry.postTask — search market (+ AZL approve if needed)
  create-task                  TaskRegistry.createTask — direct hire, skips POSTED/CLAIMED
  fund-task                    TaskRegistry.fundTask
  start-work                   TaskRegistry.startWork
  submit-proof                 TaskRegistry.submitProof
  accept-milestone             TaskRegistry.acceptMilestone
  complete-task                TaskRegistry.completeTask
  open-dispute                 TaskRegistry.openDispute
  leave-task                   TaskRegistry.leaveTask
  dismiss-worker               TaskRegistry.dismissWorker (+ AZL approve if needed)
  emergency-top-up             TaskRegistry.emergencyTopUp
  register-arbitrator          ArbitrationModule.registerArbitrator
  propose-arbitrator           ArbitrationModule.proposeArbitrator
  resolve-dispute              ArbitrationModule.resolveDispute
  resolve-timed-out            ArbitrationModule.resolveTimedOut
  escalate                     ArbitrationModule.escalate
  build-task-terms             Terms JSON + settlement digest (read-only)
  hash-criteria                Hash acceptance criteria text → bytes32 (read-only)
  prepare-receipt              Build execution receipt + receiptHash (read-only)

Common flags:
  --from <0x>                  Required for on-chain prepare actions (not hash-criteria / prepare-receipt)
  --skip-approvals             Omit automatic ERC20 approve steps in batches

Action-specific:
  onboarding    --top-up-amount <usdc6>   default 50000000 ($50)
  top-up        --amount <usdc6>
  claim-task    --task-id <id>
  post-task     --total-amount --deadline --acceptance-criteria-hash OR --criteria-text
                [--escrow-mode milestone|upfront|streaming|hour_blocks]
                [--milestone-amounts 50000000,50000000]  (must sum to total-amount)
                [--stream-rate <usdc6 per second>] [--hour-block-size <usdc6>]
                [--replacement-allowed true] [--fee-bps 100]
  create-task   --worker + same term flags as post-task
  fund-task     --task-id --amount <usdc6>  (auto USDC approve → TaskRegistry if needed)
  start-work    --task-id
  submit-proof  --task-id --milestone-index --receipt-hash <bytes32>
  accept-milestone --task-id --milestone-index
  complete-task --task-id
  open-dispute  --task-id [--evidence <text|bytes32>]
  leave-task    --task-id
  dismiss-worker --task-id
  emergency-top-up --task-id --amount <usdc6>
  register-arbitrator --task-id
  propose-arbitrator --dispute-id --arbitrator <0x>
  resolve-dispute --dispute-id --worker-bps <0-10000>
  resolve-timed-out --dispute-id
  escalate --dispute-id
  build-task-terms --from <0x> + same term flags as post-task [--worker]
  hash-criteria --text <acceptance criteria>
  prepare-receipt --task-id --worker --artifact-hash [--milestone-index] [--artifact-type] [--artifact-uri]`;
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const action = positional[0];

  if (!action || action === "help" || flags.help === "true") {
    console.log(usage());
    process.exit(0);
  }

  if (action === "read") {
    await cmdRead(requireFrom(flags));
    return;
  }

  if (action === "hash-criteria") {
    cmdHashCriteria(flags);
    return;
  }

  if (action === "prepare-receipt") {
    cmdPrepareReceipt(flags);
    return;
  }

  if (action === "build-task-terms") {
    const from = requireFrom(flags);
    output(
      buildTaskTermsBundle(from, flags, manifest, {
        requireWorker: Boolean(flags.worker),
      })
    );
    return;
  }

  const from = requireFrom(flags);

  switch (action) {
    case "onboarding":
      await cmdOnboarding(from, flags);
      break;
    case "approve-usdc-vault":
      await cmdApproveUsdcVault(from);
      break;
    case "approve-azl-router":
      await cmdApproveAzlRouter(from);
      break;
    case "top-up":
      await cmdTopUp(from, flags);
      break;
    case "claim-task":
      await cmdClaimTask(from, flags);
      break;
    case "post-task":
      await cmdPostTask(from, flags);
      break;
    case "create-task":
      await cmdCreateTask(from, flags);
      break;
    case "fund-task":
      await cmdFundTask(from, flags);
      break;
    case "start-work":
      await cmdRegistryCall("start-work", "startWork", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "submit-proof":
      await cmdRegistryCall("submit-proof", "submitProof", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        Number(flags.milestone_index ?? "0"),
        flags.receipt_hash ?? fail("--receipt-hash required"),
      ]);
      break;
    case "accept-milestone":
      await cmdRegistryCall("accept-milestone", "acceptMilestone", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        Number(flags.milestone_index ?? "0"),
      ]);
      break;
    case "complete-task":
      await cmdRegistryCall("complete-task", "completeTask", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "open-dispute":
      await cmdOpenDispute(from, flags);
      break;
    case "leave-task":
      await cmdRegistryCall("leave-task", "leaveTask", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ], { accessFee: true });
      break;
    case "dismiss-worker":
      await cmdRegistryCall("dismiss-worker", "dismissWorker", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ], { accessFee: true });
      break;
    case "emergency-top-up":
      await cmdRegistryCall("emergency-top-up", "emergencyTopUp", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        BigInt(flags.amount ?? fail("--amount required")),
      ]);
      break;
    case "register-arbitrator":
      cmdArbitration("register-arbitrator", "registerArbitrator", [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "propose-arbitrator":
      cmdArbitration("propose-arbitrator", "proposeArbitrator", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
        ethers.getAddress(flags.arbitrator ?? fail("--arbitrator required")),
      ]);
      break;
    case "resolve-dispute":
      cmdArbitration("resolve-dispute", "resolveDispute", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
        BigInt(flags.worker_bps ?? fail("--worker-bps required (0-10000)")),
      ]);
      break;
    case "resolve-timed-out":
      cmdArbitration("resolve-timed-out", "resolveTimedOut", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
      ]);
      break;
    case "escalate":
      cmdArbitration("escalate", "escalate", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
      ]);
      break;
    default:
      fail(`Unknown action: ${action}\n\n${usage()}`);
  }
}

main().catch((err) => {
  output({ ok: false, error: err.message ?? String(err) });
  process.exit(1);
});

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
const MIN_VAULT_USDC = 25_000_000n;
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
  "function availableBalance(address agent) view returns (uint256)",
  "function withdrawTo(address to, uint256 amount)",
  "function claimPayout(address to)",
]);
const REGISTRY_IFACE = new ethers.Interface([
  "function post(uint256 totalAmount, uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)",
  "function activate(uint256 taskId)",
  "function fund(uint256 taskId, uint256 amount)",
  "function markDelivered(uint256 taskId)",
  "function release(uint256 taskId, uint256 amount)",
  "function complete(uint256 taskId)",
  "function cancel(uint256 taskId)",
  "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId, bytes32 evidenceHash)",
]);

const ARBITRATION_IFACE = new ethers.Interface([
  "function registerArbitrator(uint256 taskId)",
  "function registerArbitratorGlobal()",
  "function proposeArbitrator(uint256 disputeId, address arbitrator)",
  "function resolveDispute(uint256 disputeId, uint256 workerBps)",
  "function resolveTimedOut(uint256 disputeId)",
  "function assignFallbackResolver(uint256 disputeId)",
  "function retrySideEffects(uint256 disputeId)",
  "function claimBondPayout(address to)",
  "function escalate(uint256 disputeId)",
]);

const SCOPE_IFACE = new ethers.Interface([
  "function setScope(uint256 taskId, string scope)",
  "function scopeOf(uint256 taskId) view returns (string)",
]);

const ESCROW_MODE = { milestone: 1, streaming: 2, hour_blocks: 3 };

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
  const usdc = new ethers.Contract(manifest.external.usdc, ERC20_IFACE, provider);
  const azl = new ethers.Contract(manifest.external.azl, ERC20_IFACE, provider);
  const vault = new ethers.Contract(manifest.depositVault, VAULT_IFACE, provider);

  const [vaultUsdc, walletUsdc, azlBalance, azlAllowance, usdcAllowanceVault, usdcAllowanceEscrow] =
    await Promise.all([
      vault.balanceOf(from),
      usdc.balanceOf(from),
      azl.balanceOf(from),
      azl.allowance(from, manifest.treasuryRouter),
      usdc.allowance(from, manifest.depositVault),
      usdc.allowance(from, manifest.escrowVault),
    ]);

  return {
    vaultUsdc,
    walletUsdc,
    azlBalance,
    azlAllowance,
    usdcAllowanceVault,
    usdcAllowanceEscrow,
  };
}

async function maybeAzlApprove(from, transactions) {
  const { azlAllowance } = await readAllowances(from);
  if (azlAllowance >= MIN_AZL_ALLOWANCE) return;
  transactions.push(
    tx(
      "approve-azl",
      manifest.external.azl,
      encodeApprove(manifest.external.azl, manifest.treasuryRouter, MAX_UINT256)
    )
  );
}

async function maybeUsdcApproveEscrow(from, amount, transactions) {
  const { usdcAllowanceEscrow } = await readAllowances(from);
  if (usdcAllowanceEscrow >= BigInt(amount)) return;
  transactions.push(
    tx(
      "approve-usdc-escrow",
      manifest.external.usdc,
      encodeApprove(manifest.external.usdc, manifest.escrowVault, MAX_UINT256)
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
      manifest.external.usdc,
      encodeApprove(manifest.external.usdc, manifest.depositVault, MAX_UINT256)
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
      `AgentDepositVault ${state.vaultUsdc} < ${MIN_VAULT_USDC} ($25 USDC minimum for post/claim).`
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
      taskRegistry: manifest.taskRegistry,
      depositVault: manifest.depositVault,
      escrowVault: manifest.escrowVault,
      treasuryRouter: manifest.treasuryRouter,
      usdc: manifest.external.usdc,
      azl: manifest.external.azl,
    },
    balances: {
      vaultUsdc: state.vaultUsdc.toString(),
      walletUsdc: state.walletUsdc.toString(),
      azlBalanceWei: state.azlBalance.toString(),
      azlAllowanceRouter: state.azlAllowance.toString(),
      usdcAllowanceVault: state.usdcAllowanceVault.toString(),
      usdcAllowanceEscrow: state.usdcAllowanceEscrow.toString(),
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
      manifest.depositVault,
      VAULT_IFACE.encodeFunctionData("topUp", [topUpAmount])
    )
  );
  output(batchResponse("onboarding", transactions));
}

async function cmdApproveUsdcEscrow(from) {
  output(
    batchResponse("approve-usdc-escrow", [
      tx(
        "approve-usdc-escrow",
        manifest.external.usdc,
        encodeApprove(manifest.external.usdc, manifest.escrowVault, MAX_UINT256)
      ),
    ])
  );
}

async function cmdApproveUsdcVault(from) {
  output(
    batchResponse("approve-usdc-vault", [
      tx(
        "approve-usdc-vault",
        manifest.external.usdc,
        encodeApprove(manifest.external.usdc, manifest.depositVault, MAX_UINT256)
      ),
    ])
  );
}

async function cmdApproveAzlRouter(from) {
  output(
    batchResponse("approve-azl-router", [
      tx(
        "approve-azl-router",
        manifest.external.azl,
        encodeApprove(manifest.external.azl, manifest.treasuryRouter, MAX_UINT256)
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
      manifest.depositVault,
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
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("claim", [taskId])
    )
  );
  output(batchResponse("claim-task", transactions));
}

function parseTaskTermsFromFlags(from, flags, options = {}) {
  return parseTaskTerms(from, flags, manifest, { ...options, fail });
}

async function cmdCreateTask(from, flags) {
  const parsed = parseTaskTermsFromFlags(from, flags, { requireWorker: true });
  if (parsed.terms.worker !== ethers.ZeroAddress) fail("V2 public posts cannot specify a worker");
  output(batchResponse("create-task", [
    tx("create-task", manifest.taskRegistry, REGISTRY_IFACE.encodeFunctionData("post", [
      parsed.terms.totalAmount, parsed.terms.deadline,
    ])),
  ]));
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
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("post", [parsed.terms.totalAmount, parsed.terms.deadline])
    )
  );

  const discoveryPrivate = flags.discovery === "private";
  const scopeText = (flags.scope_text ?? flags.criteria_text ?? "").trim();
  const scopeRegistry = manifest.taskScopeRegistry;
  if (!discoveryPrivate && scopeRegistry && scopeText) {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const taskCount = await new ethers.Contract(
      manifest.taskRegistry,
      ["function taskCount() view returns (uint256)"],
      provider
    ).taskCount();
    const nextTaskId = BigInt(taskCount) + 1n;
    transactions.push(
      tx(
        "set-scope",
        scopeRegistry,
        SCOPE_IFACE.encodeFunctionData("setScope", [nextTaskId, scopeText])
      )
    );
  }

  output({ ...batchResponse("post-task", transactions), warnings: parsed.warnings });
}

async function cmdSetScope(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const scope = (flags.scope_text ?? flags.scope ?? fail("--scope-text required")).trim();
  if (!manifest.taskScopeRegistry) fail("taskScopeRegistry not in manifest");
  output(
    batchResponse("set-scope", [
      tx(
        "set-scope",
        manifest.taskScopeRegistry,
        SCOPE_IFACE.encodeFunctionData("setScope", [taskId, scope])
      ),
    ])
  );
}

function cmdArbitration(action, fn, extraArgs) {
  output(
    batchResponse(action, [
      tx(action, manifest.arbitrationModule, ARBITRATION_IFACE.encodeFunctionData(fn, extraArgs)),
    ])
  );
}

async function cmdFundTask(from, flags) {
  const taskId = BigInt(flags.task_id ?? fail("--task-id required"));
  const amount = BigInt(flags.amount ?? fail("--amount required"));
  const transactions = [];
  if (flags.skip_approvals !== "true") {
    await maybeUsdcApproveEscrow(from, amount, transactions);
  }
  transactions.push(
    tx(
      "fund-task",
      manifest.taskRegistry,
      REGISTRY_IFACE.encodeFunctionData("fund", [taskId, amount])
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
        manifest.taskRegistry,
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
  transactions.push(tx(action, manifest.taskRegistry, REGISTRY_IFACE.encodeFunctionData(fn, extraArgs)));
  output(batchResponse(action, transactions));
}

function usage() {
  return `Usage (from agents/): npm run mcp:prepare -- <action> [flags]
       (direct):          node mcp/prepare-tx.mjs <action> [flags]

Actions:
  read                         Wallet + vault preflight (read-only JSON)
  onboarding                   approve USDC/AZL (if needed) + topUp
  approve-usdc-vault           ERC20 approve USDC → AgentDepositVault (deposits / access fees)
  approve-usdc-escrow          ERC20 approve USDC → EscrowVault (job funding)
  approve-azl-router           ERC20 approve AZZLE → TreasuryRouter
  top-up                       AgentDepositVault.topUp
  claim-task                   TaskRegistryV2.claim (+ AZL approve if needed)
  post-task                    TaskRegistryV2.post — AZL-denominated market task
  create-task                  Alias for V2 post (direct hire unsupported)
  fund-task                    TaskRegistryV2.fund (+ USDC approve → EscrowVault if needed)
  start-work                   TaskRegistryV2.activate
  mark-delivered               TaskRegistryV2.markDelivered
  release                      TaskRegistryV2.release
  complete-task                TaskRegistryV2.complete
  expire-task                  TaskRegistryV2.expire (permissionless after deadline)
  open-dispute                 TaskRegistry.openDispute
  cancel-task                  TaskRegistryV2.cancel (+ AZL approve if needed)
  register-arbitrator          ArbitrationModule.registerArbitrator
  register-arbitrator-global   ArbitrationModule.registerArbitratorGlobal
  propose-arbitrator           ArbitrationModule.proposeArbitrator
  resolve-dispute              ArbitrationModule.resolveDispute
  resolve-timed-out            ArbitrationModule.resolveTimedOut
  assign-fallback-resolver     ArbitrationModule.assignFallbackResolver
  retry-dispute-side-effects   ArbitrationModule.retrySideEffects
  claim-bond-payout            ArbitrationModule.claimBondPayout
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
  post-task     --total-amount <azl18> --deadline
  create-task   --total-amount <azl18> --deadline (public V2 post alias)
  fund-task     --task-id --amount <azl18>  (auto USDC approve → EscrowVault if needed; poster only)
  start-work    --task-id
  accept-direct-hire --task-id
  decline-direct-hire --task-id
  mark-delivered --task-id
  release       --task-id --amount <azl18>
  complete-task --task-id
  expire-task --task-id
  open-dispute  --task-id [--evidence <text|bytes32>]
  cancel-task   --task-id
  register-arbitrator --task-id
  register-arbitrator-global
  propose-arbitrator --dispute-id --arbitrator <0x>
  resolve-dispute --dispute-id --worker-bps <0-10000>
  resolve-timed-out --dispute-id
  assign-fallback-resolver --dispute-id
  retry-dispute-side-effects --dispute-id
  claim-bond-payout --to <0x>
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
    case "approve-usdc-escrow":
      await cmdApproveUsdcEscrow(from);
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
    case "set-scope":
      await cmdSetScope(from, flags);
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
    case "accept-direct-hire":
      await cmdRegistryCall("accept-direct-hire", "acceptDirectHire", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "decline-direct-hire":
      await cmdRegistryCall("decline-direct-hire", "declineDirectHire", flags, [
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
    case "claim-stream":
      await cmdRegistryCall("claim-stream", "claimStream", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        BigInt(flags.max_amount ?? fail("--max-amount required")),
      ]);
      break;
    case "claim-hour-block":
      await cmdRegistryCall("claim-hour-block", "claimHourBlock", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "resolve-stale-review":
      await cmdRegistryCall("resolve-stale-review", "resolveStaleReview", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "complete-task":
      await cmdRegistryCall("complete-task", "completeTask", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "expire-task":
      await cmdRegistryCall("expire-task", "expireTask", flags, [
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
    case "register-arbitrator":
      cmdArbitration("register-arbitrator", "registerArbitrator", [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "register-arbitrator-global":
      cmdArbitration("register-arbitrator-global", "registerArbitratorGlobal", []);
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
    case "assign-fallback-resolver":
      cmdArbitration("assign-fallback-resolver", "assignFallbackResolver", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
      ]);
      break;
    case "retry-dispute-side-effects":
      cmdArbitration("retry-dispute-side-effects", "retrySideEffects", [
        BigInt(flags.dispute_id ?? fail("--dispute-id required")),
      ]);
      break;
    case "claim-bond-payout":
      cmdArbitration("claim-bond-payout", "claimBondPayout", [
        ethers.getAddress(flags.to ?? fail("--to required")),
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

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
import { buildSettlementDigest } from "../dist/sdk/settlement.js";

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

  const [vaultUsdc, walletUsdc, azlBalance, azlAllowance, usdcAllowanceVault] =
    await Promise.all([
      vault.balanceOf(from),
      usdc.balanceOf(from),
      azl.balanceOf(from),
      azl.allowance(from, manifest.TreasuryRouter),
      usdc.allowance(from, manifest.AgentDepositVault),
    ]);

  return {
    vaultUsdc,
    walletUsdc,
    azlBalance,
    azlAllowance,
    usdcAllowanceVault,
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

function parseTaskTerms(from, flags, { requireWorker = false } = {}) {
  const totalAmount = BigInt(flags.total_amount ?? fail("--total-amount required (USDC 6dp)"));
  const deadline = Number(flags.deadline ?? fail("--deadline required (unix seconds)"));
  const acceptanceCriteriaHash =
    flags.acceptance_criteria_hash ?? fail("--acceptance-criteria-hash required (bytes32)");
  const escrowMode = flags.escrow_mode ?? "milestone";
  const replacementAllowed = flags.replacement_allowed === "true";
  let worker = ethers.ZeroAddress;
  if (requireWorker) {
    const raw = flags.worker ?? fail("--worker required (0x address, not zero)");
    if (!ethers.isAddress(raw) || raw === ethers.ZeroAddress) {
      fail("--worker must be a non-zero EVM address");
    }
    worker = ethers.getAddress(raw);
  }
  const digest = buildSettlementDigest({
    poster: from,
    worker,
    token: manifest.usdc,
    totalAmount,
    escrowMode,
    milestoneAmounts: [totalAmount],
    deadline,
    acceptanceCriteriaHash,
    replacementAllowed,
    feeBps: 100,
  });
  return { totalAmount, deadline, escrowMode, replacementAllowed, worker, digest };
}

async function cmdCreateTask(from, flags) {
  const terms = parseTaskTerms(from, flags, { requireWorker: true });
  output(
    batchResponse("create-task", [
      tx(
        "create-task",
        manifest.TaskRegistry,
        REGISTRY_IFACE.encodeFunctionData("createTask", [
          terms.worker,
          manifest.usdc,
          terms.totalAmount,
          ESCROW_MODE[terms.escrowMode] ?? 1,
          terms.digest,
          terms.deadline,
          terms.replacementAllowed,
          [terms.totalAmount],
          0,
          0,
        ])
      ),
    ])
  );
}

async function cmdPostTask(from, flags) {
  const terms = parseTaskTerms(from, flags);
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
        terms.totalAmount,
        ESCROW_MODE[terms.escrowMode] ?? 1,
        terms.digest,
        terms.deadline,
        [terms.totalAmount],
        0,
        0,
      ])
    )
  );
  output(batchResponse("post-task", transactions));
}

async function cmdRegistryCall(action, fn, flags, extraArgs = []) {
  const from = requireFrom(flags);
  const transactions = [];
  if (flags.skip_approvals !== "true") {
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
  leave-task                   TaskRegistry.leaveTask
  dismiss-worker               TaskRegistry.dismissWorker
  emergency-top-up             TaskRegistry.emergencyTopUp

Common flags:
  --from <0x>                  Required for all actions except help
  --skip-approvals             Omit automatic AZL approve steps

Action-specific:
  onboarding    --top-up-amount <usdc6>   default 50000000 ($50)
  top-up        --amount <usdc6>
  claim-task    --task-id <id>
  post-task     --total-amount --deadline --acceptance-criteria-hash
                [--escrow-mode milestone|upfront|streaming|hour_blocks]
                [--replacement-allowed true]
  create-task   --worker --total-amount --deadline --acceptance-criteria-hash
                (same optional flags as post-task; no access fee / no AZL approve batch)
  fund-task     --task-id --amount <usdc6>
  start-work    --task-id
  submit-proof  --task-id --milestone-index --receipt-hash <bytes32>
  accept-milestone --task-id --milestone-index
  leave-task    --task-id
  dismiss-worker --task-id
  emergency-top-up --task-id --amount <usdc6>`;
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
      await cmdRegistryCall("fund-task", "fundTask", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        BigInt(flags.amount ?? fail("--amount required")),
      ]);
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
    case "leave-task":
      await cmdRegistryCall("leave-task", "leaveTask", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "dismiss-worker":
      await cmdRegistryCall("dismiss-worker", "dismissWorker", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
      ]);
      break;
    case "emergency-top-up":
      await cmdRegistryCall("emergency-top-up", "emergencyTopUp", flags, [
        BigInt(flags.task_id ?? fail("--task-id required")),
        BigInt(flags.amount ?? fail("--amount required")),
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

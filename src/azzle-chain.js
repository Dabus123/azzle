import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  http,
  keccak256,
  numberToHex,
  parseEventLogs,
  parseUnits,
  stringToBytes,
  stringToHex,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";
import { sendDeliveryNotice } from "./xmtp-browser.js";

const AZL_PER_ACTION = 1000n * 10n ** 18n;
const MIN_ETH_WEI = 50_000_000_000_000n; // ~0.00005 ETH for gas buffer

function formatAzlHuman(amount) {
  const n = typeof amount === "bigint" ? Number(formatUnits(amount, 18)) : Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + "B AZL";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M AZL";
  return n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " AZL";
}

function formatTxError(err) {
  const msg = err?.shortMessage || err?.details || err?.message || String(err);
  const lower = msg.toLowerCase();
  if (
    err?.name === "UserRejectedRequestError" ||
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "Transaction cancelled — nothing was charged.";
  }
  if (lower.includes("ad v2: collateral") || lower.includes("below min+fee")) {
    return "Not enough AZL collateral for this V2 action. Fund your protocol collateral first.";
  }
  if (lower.includes("exceeds balance") || lower.includes("erc20: transfer amount")) {
    return "Not enough collateral in your wallet. You need AZL on Base (plus a little ETH for gas).";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough ETH on Base for gas — add a small amount of ETH, then try again.";
  }
  if (lower.includes("execution reverted") || lower.includes("revert")) {
    return "Transaction failed onchain — check you have $20 USDC and ETH for gas on Base.";
  }
  return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
}

function parseEthAddress(addr) {
  if (!addr || typeof addr !== "string") throw new Error("Recipient address required");
  const a = addr.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(a)) throw new Error("Invalid address — use a Base 0x… address");
  return a;
}

async function ensureUsdcAllowance(walletClient, publicClient, usdc, owner, spender, needed) {
  const allowance = await publicClient.readContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, spender],
  });
  if (allowance >= needed) return;
  const hash = await walletClient.writeContract({
    address: usdc,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, needed],
  });
  await publicClient.waitForTransactionReceipt({ hash });
}

async function runTx(label, fn, onProgress) {
  try {
    return await fn();
  } catch (err) {
    throw new Error(formatTxError(err));
  }
}

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
];

const VAULT_ABI = [
  {
    type: "function",
    name: "deposits",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdrawable",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }, { name: "recipient", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "available",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];

const PAYMENT_GATEWAY_ABI = [
  {
    type: "function",
    name: "fundWithUsdc",
    stateMutability: "nonpayable",
    inputs: [
      { name: "exactUsdcIn", type: "uint256" },
      { name: "minAzlOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
];

const PRICING_POLICY_ABI = [
  {
    type: "function",
    name: "quoteTask",
    stateMutability: "view",
    inputs: [],
    outputs: [{
      type: "tuple",
      components: [
        { name: "entryDeposit", type: "uint256" },
        { name: "liveTaskReserve", type: "uint256" },
        { name: "accessFee", type: "uint256" },
        { name: "exitCompensation", type: "uint256" },
        { name: "exitProtocolShare", type: "uint256" },
      ],
    }],
  },
];

const STAKING_ABI = [
  { type: "function", name: "stakingActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "stakeOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "pendingPayouts", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { type: "function", name: "unstake", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }, { name: "recipient", type: "address" }], outputs: [] },
  { type: "function", name: "bankCredits", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [{ name: "recipient", type: "address" }], outputs: [] },
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "taskCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "post",
    stateMutability: "nonpayable",
    inputs: [
      { name: "totalAmount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "markDelivered",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "activate",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "complete",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "openDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "tasks",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "funded", type: "uint256" },
          { name: "released", type: "uint256" },
          { name: "state", type: "uint8" },
          { name: "deadline", type: "uint256" },
          { name: "fundingDeadline", type: "uint256" },
          { name: "deliveredAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "event",
    name: "TaskPosted",
    inputs: [
      { name: "taskId", type: "uint256", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "totalAmount", type: "uint256", indexed: false },
      { name: "amountUsd6", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ],
  },
];

const ESCROW_ABI = [
  {
    type: "function",
    name: "escrows",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{
      type: "tuple",
      components: [
        { name: "poster", type: "address" },
        { name: "worker", type: "address" },
        { name: "deposited", type: "uint256" },
        { name: "released", type: "uint256" },
        { name: "state", type: "uint8" },
      ],
    }],
  },
];

const SCOPE_REGISTRY_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "scope", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "scopeOf",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "MAX_SCOPE_BYTES",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
];

const TASK_STATE = [
  "NONE",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "DISPUTED",
  "COMPLETED",
  "CANCELLED",
  "RESOLVED",
];

let siteConfig = null;

export async function loadSiteConfig() {
  if (siteConfig) return siteConfig;
  const res = await fetch("/api/site-config", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load site config");
  siteConfig = await res.json();
  return siteConfig;
}

function scopeHash(description) {
  return keccak256(stringToBytes(description.trim()));
}

function canonicalizeReceipt(receipt) {
  return JSON.stringify(receipt, Object.keys(receipt).sort());
}

async function readOnchainScope(publicClient, scopeRegistry, taskId) {
  if (!scopeRegistry) return null;
  try {
    const scope = await publicClient.readContract({
      address: scopeRegistry,
      abi: SCOPE_REGISTRY_ABI,
      functionName: "scopeOf",
      args: [BigInt(taskId)],
    });
    const text = String(scope ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

async function writeSetScope(walletClient, publicClient, scopeRegistry, taskId, scope, onProgress) {
  onProgress?.("Publishing scope onchain…");
  const receipt = await runTx("publishScope", async () => {
    const hash = await walletClient.writeContract({
      address: scopeRegistry,
      abi: SCOPE_REGISTRY_ABI,
      functionName: "publish",
      args: [BigInt(taskId), scope.trim()],
    });
    return publicClient.waitForTransactionReceipt({ hash });
  }, onProgress);
  return receipt;
}

/** Batch scope publication immediately after post when wallet supports wallet_sendCalls. */
async function tryPostWithOpenScopeBatch(wallet, walletClient, publicClient, cfg, postArgs, scope, onProgress) {
  const c = cfg.contracts;
  if (!c.taskScopeRegistry) return null;

  const taskCount = await publicClient.readContract({
    address: c.taskRegistry,
    abi: REGISTRY_ABI,
    functionName: "taskCount",
  });
  const nextTaskId = taskCount + 1n;

  const postData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "post",
    args: postArgs,
  });
  const scopeData = encodeFunctionData({
    abi: SCOPE_REGISTRY_ABI,
    functionName: "publish",
    args: [nextTaskId, scope.trim()],
  });

  const provider = await wallet.getEthereumProvider();
  const chainId = numberToHex(cfg.chainId ?? base.id);
  const from = wallet.address;

  try {
    onProgress?.("Posting task + publishing scope (batched)…");
    const result = await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId,
          from,
          calls: [
            { to: c.taskRegistry, data: postData, value: "0x0" },
            { to: c.taskScopeRegistry, data: scopeData, value: "0x0" },
          ],
        },
      ],
    });

    const batchId = typeof result === "string" ? result : result?.id;
    if (!batchId) return null;

    let status = null;
    for (let i = 0; i < 40; i++) {
      status = await provider.request({
        method: "wallet_getCallsStatus",
        params: [batchId],
      });
      if (status?.status === 200 || status?.status === "CONFIRMED") break;
      if (status?.status === 500 || status?.status === "FAILED") {
        throw new Error("Batched post failed onchain");
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    const receipts = status?.receipts ?? [];
    const txHash = receipts[0]?.transactionHash ?? status?.transactionHash ?? null;
    return { taskId: nextTaskId.toString(), hash: txHash, scopePublished: true, batched: true };
  } catch {
    return null;
  }
}

async function getWalletClient(wallet, cfg) {
  const provider = await wallet.getEthereumProvider();
  const chain = { ...base, id: cfg.chainId ?? base.id };
  try {
    await wallet.switchChain?.(chain.id);
  } catch {
    /* wallet may already be on Base */
  }
  return createWalletClient({
    account: wallet.address,
    chain,
    transport: custom(provider),
  });
}

function getPublicClient(cfg) {
  return createPublicClient({
    chain: base,
    transport: http(cfg.rpcUrl ?? "https://mainnet.base.org"),
  });
}

function taskIdFromReceipt(receipt, registry) {
  const logs = parseEventLogs({
    abi: REGISTRY_ABI,
    logs: receipt.logs,
    eventName: "TaskPosted",
  });
  const hit = logs.find((l) => l.address.toLowerCase() === registry.toLowerCase());
  if (!hit) throw new Error("Task ID not found in receipt");
  return hit.args.taskId;
}

export function createPosterApi({ ready, authenticated, wallet }) {
  const idle = {
    ready: false,
    address: null,
    async getStatus() {
      return { signedIn: false };
    },
    async deposit() {
      throw new Error("Sign in first");
    },
    async postV2() {
      throw new Error("Sign in first");
    },
    async fundV2() {
      throw new Error("Sign in first");
    },
    async claimV2() {
      throw new Error("Sign in first");
    },
    async markDeliveredV2() {
      throw new Error("Sign in first");
    },
    async sendDeliveryNotice() {
      throw new Error("Sign in first");
    },
    buildDeliveryReceipt() {
      throw new Error("Sign in first");
    },
  };

  if (!ready) return idle;

  const address = wallet?.address ?? null;
  if (!authenticated || !address || !wallet) {
    return { ...idle, ready: true, address: null };
  }

  return {
    ready: true,
    address,

    async getStatus() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      if (!c?.taskRegistry) return { signedIn: true, configured: false };

      const publicClient = getPublicClient(cfg);
      const [usdcBal, depositBal, azlBal, usdcAllowGateway, quote] =
        await publicClient.multicall({
          contracts: [
            { address: c.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
            { address: c.depositVault, abi: VAULT_ABI, functionName: "deposits", args: [address] },
            { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
            { address: c.usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, c.paymentGateway] },
            { address: c.pricingPolicy, abi: PRICING_POLICY_ABI, functionName: "quoteTask" },
          ],
        });

      const deposit = depositBal.result ?? 0n;
      const usdc = usdcBal.result ?? 0n;
      const entryDeposit = quote.result?.entryDeposit ?? 0n;
      const liveTaskReserve = quote.result?.liveTaskReserve ?? 0n;
      const accessFee = quote.result?.accessFee ?? 0n;
      const needsDeposit = deposit < entryDeposit;
      const needsPostTopUp = deposit < entryDeposit + liveTaskReserve + accessFee;
      const needsUsdcApprove = (usdcAllowGateway.result ?? 0n) === 0n;

      return {
        signedIn: true,
        configured: true,
        usdcWallet: formatUnits(usdc, 6),
        depositAzl: formatUnits(deposit, 18),
        azlWallet: formatUnits(azlBal.result ?? 0n, 18),
        needsDeposit,
        needsPostTopUp,
        needsUsdcApprove,
        depositReady: !needsDeposit,
        canDeposit: usdc > 0n,
        canPost:
          deposit >= entryDeposit + liveTaskReserve + accessFee &&
          (azlBal.result ?? 0n) >= AZL_PER_ACTION,
        taskFloorMin: formatUnits(liveTaskReserve, 18),
        listingFeeUsdc: formatUnits(accessFee, 18),
        entryDepositMin: formatUnits(entryDeposit, 18),
      };
    },

    async getWalletBalances() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      if (!c?.taskRegistry) return { signedIn: true, configured: false };

      const publicClient = getPublicClient(cfg);
      const eth = await publicClient.getBalance({ address });
      const [usdc, azl, vault, maxW, usdcAllowGateway] = await publicClient.multicall({
        contracts: [
          { address: c.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.depositVault, abi: VAULT_ABI, functionName: "deposits", args: [address] },
          { address: c.depositVault, abi: VAULT_ABI, functionName: "withdrawable", args: [address] },
          { address: c.usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, c.paymentGateway] },
        ],
      });

      const vaultAmt = vault.result ?? 0n;
      const maxWithdrawAmt = maxW.result ?? 0n;
      const usdcAllowance = usdcAllowGateway.result ?? 0n;

      return {
        signedIn: true,
        configured: true,
        address,
        eth: formatUnits(eth, 18),
        usdcWallet: formatUnits(usdc.result ?? 0n, 6),
        usdcVault: formatUnits(vaultAmt, 18),
        usdcVaultAllowance: formatUnits(usdcAllowance, 6),
        needsUsdcApprove: usdcAllowance === 0n,
        maxVaultWithdraw: formatUnits(maxWithdrawAmt, 18),
        azlWallet: formatUnits(azl.result ?? 0n, 18),
        entryDepositMin: "oracle-priced AZL",
        taskFloorMin: "oracle-priced AZL",
        listingFeeUsdc: "oracle-priced AZL",
        depositReady: vaultAmt > 0n,
        canPost: vaultAmt > 0n,
        needsPostTopUp: false,
      };
    },

    async approveUsdcGateway(amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      const allowance = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.paymentGateway],
      });
      if (allowance >= amount) {
        throw new Error(
          "Already approved for $" +
            formatUnits(allowance, 6) +
            " — enter a higher amount to increase allowance."
        );
      }

      const eth = await publicClient.getBalance({ address });
      if (eth < MIN_ETH_WEI) {
        throw new Error("Not enough ETH on Base for gas.");
      }

      onProgress?.("Approve $" + amountUsdc + " USDC for protocol deposit…");
      const receipt = await runTx("approveUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [c.paymentGateway, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async fundCollateral(amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      const usdc = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (usdc < amount) {
        throw new Error(
          "Not enough USDC in wallet — you have $" + formatUnits(usdc, 6) + "."
        );
      }
      const eth = await publicClient.getBalance({ address });
      if (eth < MIN_ETH_WEI) {
        throw new Error("Not enough ETH on Base for gas.");
      }

      onProgress?.("Approve USDC for protocol deposit…");
      await ensureUsdcAllowance(walletClient, publicClient, c.usdc, address, c.paymentGateway, amount);

      onProgress?.("Converting USDC to AZL collateral…");
      const receipt = await runTx("fundWithUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.paymentGateway,
          abi: PAYMENT_GATEWAY_ABI,
          functionName: "fundWithUsdc",
          args: [amount, 1n, BigInt(Math.floor(Date.now() / 1000) + 600)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async withdrawCollateral(amountAzl, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);

      const maxW = await publicClient.readContract({
        address: c.depositVault,
        abi: VAULT_ABI,
        functionName: "withdrawable",
        args: [address],
      });
      const amount = parseUnits(String(amountAzl), 18);
      if (amount <= 0n) throw new Error("Enter a valid AZL amount");
      if (amount > maxW) {
        throw new Error(
          "Max withdrawable now is " +
            formatUnits(maxW, 18) +
            " AZL."
        );
      }

      onProgress?.("Withdrawing " + amountAzl + " AZL collateral…");
      const receipt = await runTx("withdraw", async () => {
        const hash = await walletClient.writeContract({
          address: c.depositVault,
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [amount, address],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendUsdc(to, amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");

      onProgress?.("Sending $" + amountUsdc + " USDC…");
      const receipt = await runTx("sendUsdc", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendAzl(to, amountAzl, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountAzl), 18);
      if (amount <= 0n) throw new Error("Enter a valid AZL amount");

      onProgress?.("Sending " + amountAzl + " AZL…");
      const receipt = await runTx("sendAzl", async () => {
        const hash = await walletClient.writeContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [recipient, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async sendEth(to, amountEth, onProgress) {
      const cfg = await loadSiteConfig();
      const recipient = parseEthAddress(to);
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const value = parseUnits(String(amountEth), 18);
      if (value <= 0n) throw new Error("Enter a valid ETH amount");

      const bal = await publicClient.getBalance({ address });
      if (bal <= value) throw new Error("Not enough ETH (leave some for gas).");

      onProgress?.("Sending " + amountEth + " ETH…");
      const receipt = await runTx("sendEth", async () => {
        const hash = await walletClient.sendTransaction({ account: address, to: recipient, value });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async deposit(onProgress) {
      return this.fundCollateral(25, onProgress);
    },

    async postV2({ description, taskAmountAzl, deadlineDays, discoveryOpen = true }, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const status = await this.getStatus();
      const openDiscovery = discoveryOpen !== false;

      if (status.needsDeposit) throw new Error("Fund AZL collateral first — /wallet");

      const totalAmount = parseUnits(String(taskAmountAzl), 18);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineDays * 86400);
      const postArgs = [totalAmount, deadline];

      if (openDiscovery && c.taskScopeRegistry) {
        const batched = await tryPostWithOpenScopeBatch(
          wallet,
          walletClient,
          publicClient,
          cfg,
          postArgs,
          description,
          onProgress
        );
        if (batched) return batched;
      }

      onProgress?.("Posting to the market…");
      const receipt = await runTx("post", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "post",
          args: postArgs,
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      const taskId = taskIdFromReceipt(receipt, c.taskRegistry);

      if (openDiscovery && c.taskScopeRegistry) {
        await writeSetScope(
          walletClient,
          publicClient,
          c.taskScopeRegistry,
          taskId,
          description,
          onProgress
        );
        return {
          taskId: taskId.toString(),
          hash: receipt.transactionHash,
          scopePublished: true,
          batched: false,
        };
      }

      return {
        taskId: taskId.toString(),
        hash: receipt.transactionHash,
        scopePublished: false,
        discoveryOpen: false,
      };
    },

    async setTaskScope(taskId, scope, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      if (!c.taskScopeRegistry) {
        throw new Error("Task scope registry not configured");
      }
      const text = String(scope ?? "").trim();
      if (!text) throw new Error("Scope cannot be empty");
      if (text.length > 8192) throw new Error("Scope too long (max 8192 bytes)");

      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const receipt = await writeSetScope(
        walletClient,
        publicClient,
        c.taskScopeRegistry,
        taskId,
        text,
        onProgress
      );
      return { hash: receipt.transactionHash };
    },

    async payUpgrade(tierId, options, onProgress) {
      const opts = typeof options === "function" ? { onProgress: options } : options ?? {};
      const progress = typeof options === "function" ? options : onProgress;
      const payWith = opts.payWith ?? "usdc";
      const quote = opts.quote ?? null;

      const cfg = await loadSiteConfig();
      const billingWallet = cfg.billingWallet;
      if (!billingWallet) throw new Error("Billing wallet not configured — contact support.");
      const plan = (cfg.postingPlans ?? []).find((p) => p.id === tierId);
      if (!plan || !plan.priceUsdc) throw new Error("Invalid upgrade plan");

      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);

      if (payWith === "azl") {
        if (!quote?.minAzlWei) throw new Error("AZL quote required — refresh and try again.");
        const amount = BigInt(quote.minAzlWei);
        const azlBal = await publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        });
        if (azlBal < amount) {
          throw new Error(
            "Not enough AZL — need " +
              formatAzlHuman(amount) +
              " on Base (you have " +
              formatAzlHuman(azlBal) +
              ")."
          );
        }
        progress?.(
          "Pay " +
            (quote.azlAmountFormatted || formatAzlHuman(amount)) +
            " (~$" +
            quote.discountedUsd +
            " · 10% off)…"
        );
        const receipt = await runTx("upgradeAzl", async () => {
          const hash = await walletClient.writeContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "transfer",
            args: [billingWallet, amount],
          });
          return publicClient.waitForTransactionReceipt({ hash });
        }, progress);
        return { hash: receipt.transactionHash, tier: tierId, payWith: "azl", quoteId: quote.quoteId };
      }

      const amount = parseUnits(String(plan.priceUsdc), 6);
      const usdc = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      });
      if (usdc < amount) {
        throw new Error(
          "Not enough USDC — need $" + plan.priceUsdc + " on Base (you have $" + formatUnits(usdc, 6) + ")."
        );
      }

      progress?.("Pay $" + plan.priceUsdc + " USDC for " + plan.label + "…");
      const receipt = await runTx("upgrade", async () => {
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [billingWallet, amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, progress);

      return { hash: receipt.transactionHash, tier: tierId, payWith: "usdc" };
    },

    async fundV2(taskId, amountAzl, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(amountAzl), 18);

      const allowance = await publicClient.readContract({
        address: c.azlToken,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.escrowVault],
      });
      if (allowance < amount) {
        onProgress?.("Approve AZL for escrow…");
        const hash = await walletClient.writeContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [c.escrowVault, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      onProgress?.("Locking payment in escrow…");
      const hash = await walletClient.writeContract({
        address: c.taskRegistry,
        abi: REGISTRY_ABI,
        functionName: "fund",
        args: [BigInt(taskId), amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash: receipt.transactionHash };
    },

    async claimReadiness() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      const [depositBal, azlBal, eth, quote] = await Promise.all([
        publicClient.readContract({
          address: c.depositVault,
          abi: VAULT_ABI,
          functionName: "deposits",
          args: [address],
        }),
        publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
        publicClient.getBalance({ address }),
        publicClient.readContract({
          address: c.pricingPolicy,
          abi: PRICING_POLICY_ABI,
          functionName: "quoteTask",
        }),
      ]);
      const entryDeposit = quote.entryDeposit ?? 0n;
      const liveTaskReserve = quote.liveTaskReserve ?? 0n;
      const accessFee = quote.accessFee ?? 0n;
      const requiredDeposit = entryDeposit + liveTaskReserve + accessFee;
      return {
        depositAzl: formatUnits(depositBal, 18),
        accessFeeAzl: formatUnits(accessFee, 18),
        requiredDepositAzl: formatUnits(requiredDeposit, 18),
        hasCollateral: depositBal >= requiredDeposit,
        hasGas: eth >= MIN_ETH_WEI,
        walletAzl: formatUnits(azlBal, 18),
      };
    },

    async claimV2(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Claiming task on Base…");
      const receipt = await runTx("claim", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "claim",
          args: [BigInt(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async getTaskDetail(taskId) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      const id = BigInt(taskId);
      const [task, locked] = await publicClient.multicall({
        contracts: [
          { address: c.taskRegistry, abi: REGISTRY_ABI, functionName: "tasks", args: [id] },
          { address: c.escrowVault, abi: ESCROW_ABI, functionName: "escrows", args: [id] },
        ],
      });
      const row = task.result;
      const stateName = TASK_STATE[Number(row.state)] ?? "UNKNOWN";
      const totalAmount = row.totalAmount;
      const lockedBal = locked.result
        ? locked.result.deposited - locked.result.released
        : 0n;
      const scope = await readOnchainScope(publicClient, c.taskScopeRegistry, taskId);
      return {
        taskId: String(taskId),
        state: stateName,
        poster: row.poster,
        worker: row.worker === zeroAddress ? null : row.worker,
        budgetAzl: formatUnits(totalAmount, 18),
        taskAmountAzl: formatUnits(totalAmount, 18),
        fundedAzl: formatUnits(row.funded, 18),
        releasedAzl: formatUnits(row.released, 18),
        lockedAzl: formatUnits(lockedBal, 18),
        funded: row.funded >= totalAmount && totalAmount > 0n,
        deadline: Number(row.deadline),
        fundingDeadline: Number(row.fundingDeadline),
        deliveredAt: Number(row.deliveredAt),
        scope,
        discoveryOpen: Boolean(scope),
      };
    },

    async markDeliveredV2(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Recording delivery on Base…");
      const receipt = await runTx("markDelivered", async () => {
        const hash = await walletClient.writeContract({
          address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "markDelivered",
          args: [BigInt(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    buildDeliveryReceipt({ taskId, artifactUri, summary }) {
      const artifactHash = keccak256(stringToBytes(artifactUri));
      const receipt = {
        schemaVersion: "azzle-receipt-v2",
        taskId: String(taskId),
        worker: address,
        completedAt: new Date().toISOString(),
        artifacts: [{ type: "delivery", hash: artifactHash, uri: artifactUri }],
        availability: {
          retrievalUri: artifactUri,
          verifiedAt: new Date().toISOString(),
          contentAddressed: artifactUri.startsWith("ipfs://") || artifactUri.startsWith("ar://"),
        },
      };
      return {
        receipt,
        receiptHash: keccak256(stringToBytes(canonicalizeReceipt(receipt))),
        summary,
      };
    },

    async sendDeliveryNotice({ taskId, poster, receiptHash, receiptUri, artifactUris, receipt, summary }, onProgress) {
      onProgress?.("Opening private XMTP delivery notice…");
      return sendDeliveryNotice({
        wallet,
        poster,
        notice: { taskId, receiptHash, receiptUri, artifactUris, receipt, summary },
      });
    },

    async activateV2(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Activating task…");
      const receipt = await runTx("activate", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
        functionName: "activate",
          args: [BigInt(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async completeV2(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Accepting delivery — releasing escrow…");
      const receipt = await runTx("complete", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
        functionName: "complete",
        args: [BigInt(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async openDispute(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const evidenceHash = keccak256(stringToBytes("poster-dispute:" + taskId));
      onProgress?.("Opening dispute — escrow frozen…");
      const receipt = await runTx("openDispute", async () => {
        const hash = await walletClient.writeContract({
        address: c.taskRegistry,
          abi: REGISTRY_ABI,
          functionName: "openDispute",
          args: [BigInt(taskId), evidenceHash],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async getUnionPosition() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      const [active, walletAzl, staked, credits, remaining, pending] = await publicClient.multicall({
        contracts: [
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "stakingActive" },
          { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "stakeOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "creditsOf", args: [address] },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "creditsRemaining" },
          { address: c.stakingVault, abi: STAKING_ABI, functionName: "pendingPayouts", args: [address] },
        ],
      });
      return {
        signedIn: true,
        active: Boolean(active.result),
        walletAzl: formatUnits(walletAzl.result ?? 0n, 18),
        stakedAzl: formatUnits(staked.result ?? 0n, 18),
        credits: formatUnits(credits.result ?? 0n, 18),
        wholeCredits: formatUnits(credits.result ?? 0n, 18),
        creditsRemaining: formatUnits(remaining.result ?? 0n, 18),
        claimableAzl: formatUnits(pending.result ?? 0n, 18),
      };
    },

    async unionTx(action, value, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = value == null || value === "" || /^0x/i.test(String(value))
        ? 0n
        : parseUnits(String(value), 18);
      const stakeAmount = action === "claimUnstakeTo"
        ? await publicClient.readContract({
            address: c.stakingVault,
            abi: STAKING_ABI,
            functionName: "stakeOf",
            args: [address],
          })
        : amount;
      if (action === "stake") {
        const allowance = await publicClient.readContract({
          address: c.azlToken,
          abi: ERC20_ABI,
          functionName: "allowance",
          args: [address, c.stakingVault],
        });
        if (allowance < amount) {
          const approval = await walletClient.writeContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [c.stakingVault, amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approval });
        }
      }
      const args = action === "stake" ? [amount] :
        action === "unstake" || action === "claimUnstakeTo" ? [stakeAmount, address] :
        action === "claimRewards" ? [address] : [];
      const functionName = action === "claimUnstakeTo" ? "unstake" :
        action === "claimRewards" ? "claim" : action;
      onProgress?.("Submitting Union transaction…");
      const hash = await walletClient.writeContract({
        address: c.stakingVault,
        abi: STAKING_ABI,
        functionName,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash: receipt.transactionHash };
    },

    async fundAndActivate(taskId, amountAzl, onProgress) {
      const detail = await this.getTaskDetail(taskId);
      if (!detail.funded) {
        await this.fundV2(taskId, amountAzl, onProgress);
      }
      return this.activateV2(taskId, onProgress);
    },
  };
}

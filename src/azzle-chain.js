import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  formatUnits,
  http,
  keccak256,
  parseEventLogs,
  parseUnits,
  stringToBytes,
  stringToHex,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";

const ENTRY_DEPOSIT = 20_000_000n; // $20 USDC (6 decimals)
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
  if (lower.includes("exceeds balance") || lower.includes("erc20: transfer amount")) {
    return "Not enough USDC in your wallet. You need $20 USDC on Base (plus a little ETH for gas).";
  }
  if (lower.includes("insufficient funds")) {
    return "Not enough ETH on Base for gas — add a small amount of ETH, then try again.";
  }
  if (lower.includes("execution reverted") || lower.includes("revert")) {
    return "Transaction failed onchain — check you have $20 USDC and ETH for gas on Base.";
  }
  return msg.length > 140 ? msg.slice(0, 140) + "…" : msg;
}

async function assertDepositFunds(publicClient, address, usdcAddress) {
  const usdc = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
  if (usdc < ENTRY_DEPOSIT) {
    throw new Error(
      "Not enough USDC — you have $" +
        formatUnits(usdc, 6) +
        ", need $20 on Base (plus a little ETH for gas)."
    );
  }
  const eth = await publicClient.getBalance({ address });
  if (eth < MIN_ETH_WEI) {
    throw new Error(
      "Not enough ETH on Base for gas — add a small amount of ETH, then try deposit again."
    );
  }
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
    args: [spender, parseUnits("1000000", 6)],
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
    name: "topUp",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
];

const REGISTRY_ABI = [
  {
    type: "function",
    name: "postTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "totalAmount", type: "uint256" },
      { name: "escrowMode", type: "uint8" },
      { name: "settlementDigest", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "milestoneAmounts", type: "uint256[]" },
      { name: "streamRate", type: "uint256" },
      { name: "hourBlockSize", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "fundTask",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "startWork",
    stateMutability: "nonpayable",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "acceptMilestone",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "milestoneIndex", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "openDispute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "taskId", type: "uint256" },
      { name: "evidenceHash", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "maxWithdrawableDeposit",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getTask",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        name: "",
        components: [
          { name: "poster", type: "address" },
          { name: "worker", type: "address" },
          { name: "token", type: "address" },
          { name: "totalAmount", type: "uint256" },
          { name: "escrowMode", type: "uint8" },
          { name: "settlementDigest", type: "bytes32" },
          { name: "state", type: "uint8" },
          { name: "deadline", type: "uint256" },
          { name: "createdAt", type: "uint256" },
          { name: "replacementAllowed", type: "bool" },
          { name: "parentTaskId", type: "uint256" },
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
      { name: "settlementDigest", type: "bytes32", indexed: false },
    ],
  },
];

const ESCROW_ABI = [
  {
    type: "function",
    name: "lockedBalance",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];

const TASK_STATE = [
  "DRAFT",
  "POSTED",
  "CLAIMED",
  "ACTIVE",
  "IN_REVIEW",
  "COMPLETED",
  "CANCELLED",
  "EXPIRED",
  "DISPUTED",
  "RESOLVED",
  "REPLACING",
  "PAUSED",
  "DELETED",
];

let siteConfig = null;

export async function loadSiteConfig() {
  if (siteConfig) return siteConfig;
  const res = await fetch("/api/site-config", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load site config");
  siteConfig = await res.json();
  return siteConfig;
}

export function buildSettlementDigest(terms) {
  const milestoneAmounts = terms.milestoneAmounts ?? [terms.totalAmount];
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
        { type: "uint8" },
        { type: "uint256[]" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bool" },
        { type: "uint16" },
      ],
      [
        keccak256(stringToBytes("azzle-task-v1")),
        terms.poster,
        terms.worker,
        terms.token,
        terms.totalAmount,
        terms.escrowMode,
        milestoneAmounts,
        terms.deadline,
        terms.acceptanceCriteriaHash,
        terms.replacementAllowed,
        terms.feeBps ?? 100,
      ]
    )
  );
}

function scopeHash(description) {
  return keccak256(stringToBytes(description.trim()));
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
    async postTask() {
      throw new Error("Sign in first");
    },
    async fundEscrow() {
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
      if (!c?.TaskRegistry) return { signedIn: true, configured: false };

      const publicClient = getPublicClient(cfg);
      const [usdcBal, depositBal, azlBal, usdcAllowVault, azlAllowTreasury] =
        await publicClient.multicall({
          contracts: [
            { address: c.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
            { address: c.AgentDepositVault, abi: VAULT_ABI, functionName: "balanceOf", args: [address] },
            { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
            { address: c.usdc, abi: ERC20_ABI, functionName: "allowance", args: [address, c.AgentDepositVault] },
            { address: c.azlToken, abi: ERC20_ABI, functionName: "allowance", args: [address, c.TreasuryRouter] },
          ],
        });

      const deposit = depositBal.result ?? 0n;
      const usdc = usdcBal.result ?? 0n;
      const needsDeposit = deposit < ENTRY_DEPOSIT;
      const needsUsdcApprove = (usdcAllowVault.result ?? 0n) < ENTRY_DEPOSIT;
      const needsAzlApprove = (azlAllowTreasury.result ?? 0n) < AZL_PER_ACTION;

      return {
        signedIn: true,
        configured: true,
        usdcWallet: formatUnits(usdc, 6),
        depositUsdc: formatUnits(deposit, 6),
        azlWallet: formatUnits(azlBal.result ?? 0n, 18),
        needsDeposit,
        needsUsdcApprove,
        needsAzlApprove,
        depositReady: !needsDeposit,
        canDeposit: usdc >= ENTRY_DEPOSIT,
        canPost: !needsDeposit && (azlBal.result ?? 0n) >= AZL_PER_ACTION,
      };
    },

    async getWalletBalances() {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      if (!c?.TaskRegistry) return { signedIn: true, configured: false };

      const publicClient = getPublicClient(cfg);
      const eth = await publicClient.getBalance({ address });
      const [usdc, azl, vault, maxW] = await publicClient.multicall({
        contracts: [
          { address: c.usdc, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.azlToken, abi: ERC20_ABI, functionName: "balanceOf", args: [address] },
          { address: c.AgentDepositVault, abi: VAULT_ABI, functionName: "balanceOf", args: [address] },
          { address: c.TaskRegistry, abi: REGISTRY_ABI, functionName: "maxWithdrawableDeposit", args: [address] },
        ],
      });

      const vaultAmt = vault.result ?? 0n;
      const maxWithdrawAmt = maxW.result ?? 0n;

      return {
        signedIn: true,
        configured: true,
        address,
        eth: formatUnits(eth, 18),
        usdcWallet: formatUnits(usdc.result ?? 0n, 6),
        usdcVault: formatUnits(vaultAmt, 6),
        maxVaultWithdraw: formatUnits(maxWithdrawAmt, 6),
        azlWallet: formatUnits(azl.result ?? 0n, 18),
        entryDepositMin: formatUnits(ENTRY_DEPOSIT, 6),
        depositReady: vaultAmt >= ENTRY_DEPOSIT,
      };
    },

    async depositToVault(amountUsdc, onProgress) {
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
      await ensureUsdcAllowance(walletClient, publicClient, c.usdc, address, c.AgentDepositVault, amount);

      onProgress?.("Depositing $" + amountUsdc + " USDC to protocol…");
      const receipt = await runTx("topUp", async () => {
        const hash = await walletClient.writeContract({
          address: c.AgentDepositVault,
          abi: VAULT_ABI,
          functionName: "topUp",
          args: [amount],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async withdrawFromVault(amountUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);

      const maxW = await publicClient.readContract({
        address: c.TaskRegistry,
        abi: REGISTRY_ABI,
        functionName: "maxWithdrawableDeposit",
        args: [address],
      });
      const amount = parseUnits(String(amountUsdc), 6);
      if (amount <= 0n) throw new Error("Enter a valid USDC amount");
      if (amount > maxW) {
        throw new Error(
          "Max withdrawable now is $" +
            formatUnits(maxW, 6) +
            " (keep $8 while a task is live)."
        );
      }

      onProgress?.("Withdrawing $" + amountUsdc + " USDC…");
      const receipt = await runTx("withdraw", async () => {
        const hash = await walletClient.writeContract({
          address: c.AgentDepositVault,
          abi: VAULT_ABI,
          functionName: "withdraw",
          args: [amount],
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
      const status = await this.getStatus();
      if (status.depositReady) {
        return { hash: null, alreadyDeposited: true };
      }
      return this.depositToVault(Number(formatUnits(ENTRY_DEPOSIT, 6)), onProgress);
    },

    async postTask({ description, budgetUsdc, deadlineDays }, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const status = await this.getStatus();

      if (status.needsDeposit) {
        throw new Error("Deposit $20 USDC first");
      }
      if ((await publicClient.readContract({
        address: c.azlToken,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) < AZL_PER_ACTION) {
        throw new Error("You need at least 1,000 AZL in your wallet to post");
      }

      if (status.needsAzlApprove) {
        onProgress?.("Approve AZL for listing fee…");
        await runTx("approveAzl", async () => {
          const hash = await walletClient.writeContract({
            address: c.azlToken,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [c.TreasuryRouter, parseUnits("100000", 18)],
          });
          await publicClient.waitForTransactionReceipt({ hash });
        }, onProgress);
      }

      const totalAmount = parseUnits(String(budgetUsdc), 6);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + deadlineDays * 86400);
      const acceptanceCriteriaHash = scopeHash(description);
      const digest = buildSettlementDigest({
        poster: address,
        worker: zeroAddress,
        token: c.usdc,
        totalAmount,
        escrowMode: 1,
        milestoneAmounts: [totalAmount],
        deadline,
        acceptanceCriteriaHash,
        replacementAllowed: false,
        feeBps: 100,
      });

      onProgress?.("Posting to the market…");
      const receipt = await runTx("postTask", async () => {
        const hash = await walletClient.writeContract({
          address: c.TaskRegistry,
          abi: REGISTRY_ABI,
          functionName: "postTask",
          args: [c.usdc, totalAmount, 1, digest, deadline, [totalAmount], 0n, 0n],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      const taskId = taskIdFromReceipt(receipt, c.TaskRegistry);

      return { taskId: taskId.toString(), hash: receipt.transactionHash };
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

    async fundEscrow(taskId, budgetUsdc, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      const amount = parseUnits(String(budgetUsdc), 6);

      const allowance = await publicClient.readContract({
        address: c.usdc,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [address, c.EscrowVault],
      });
      if (allowance < amount) {
        onProgress?.("Approve USDC for escrow…");
        const hash = await walletClient.writeContract({
          address: c.usdc,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [c.EscrowVault, parseUnits("1000000", 6)],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      onProgress?.("Locking payment in escrow…");
      const hash = await walletClient.writeContract({
        address: c.TaskRegistry,
        abi: REGISTRY_ABI,
        functionName: "fundTask",
        args: [BigInt(taskId), amount],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash: receipt.transactionHash };
    },

    async getTaskDetail(taskId) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const publicClient = getPublicClient(cfg);
      const id = BigInt(taskId);
      const [task, locked] = await publicClient.multicall({
        contracts: [
          { address: c.TaskRegistry, abi: REGISTRY_ABI, functionName: "getTask", args: [id] },
          { address: c.EscrowVault, abi: ESCROW_ABI, functionName: "lockedBalance", args: [id] },
        ],
      });
      const row = task.result;
      const stateName = TASK_STATE[Number(row.state)] ?? "UNKNOWN";
      const totalAmount = row.totalAmount;
      const lockedBal = locked.result ?? 0n;
      return {
        taskId: String(taskId),
        state: stateName,
        worker: row.worker === zeroAddress ? null : row.worker,
        budgetUsdc: formatUnits(totalAmount, 6),
        lockedUsdc: formatUnits(lockedBal, 6),
        funded: lockedBal >= totalAmount && totalAmount > 0n,
        deadline: Number(row.deadline),
      };
    },

    async startWork(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Starting work…");
      const receipt = await runTx("startWork", async () => {
        const hash = await walletClient.writeContract({
          address: c.TaskRegistry,
          abi: REGISTRY_ABI,
          functionName: "startWork",
          args: [BigInt(taskId)],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async acceptWork(taskId, onProgress) {
      const cfg = await loadSiteConfig();
      const c = cfg.contracts;
      const walletClient = await getWalletClient(wallet, cfg);
      const publicClient = getPublicClient(cfg);
      onProgress?.("Accepting delivery — releasing escrow…");
      const receipt = await runTx("acceptMilestone", async () => {
        const hash = await walletClient.writeContract({
          address: c.TaskRegistry,
          abi: REGISTRY_ABI,
          functionName: "acceptMilestone",
          args: [BigInt(taskId), 0n],
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
          address: c.TaskRegistry,
          abi: REGISTRY_ABI,
          functionName: "openDispute",
          args: [BigInt(taskId), evidenceHash],
        });
        return publicClient.waitForTransactionReceipt({ hash });
      }, onProgress);
      return { hash: receipt.transactionHash };
    },

    async fundAndStart(taskId, budgetUsdc, onProgress) {
      const detail = await this.getTaskDetail(taskId);
      if (!detail.funded) {
        await this.fundEscrow(taskId, budgetUsdc, onProgress);
      }
      return this.startWork(taskId, onProgress);
    },
  };
}

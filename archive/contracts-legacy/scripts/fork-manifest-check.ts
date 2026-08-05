/**
 * Live Base RPC check — wiring + ABI selectors vs base-8453.json (no Hardhat fork).
 * Run after compile: npm run fork:check
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ethers } from "ethers";
import manifest from "../deployments/base-8453.json";

const CONTRACT_KEYS = [
  "EscrowVault",
  "TaskRegistry",
  "ReputationRegistry",
  "ArbitrationModule",
  "TreasuryRouter",
  "AgentDepositVault",
] as const;

const READ_ABI = {
  TaskRegistry: [
    "function arbitration() view returns (address)",
    "function treasury() view returns (address)",
    "function agentVault() view returns (address)",
  ],
  EscrowVault: [
    "function taskRegistry() view returns (address)",
    "function arbitrationModule() view returns (address)",
  ],
  AgentDepositVault: [
    "function taskRegistry() view returns (address)",
    "function treasury() view returns (address)",
    "function MIN_ENTRY_BALANCE() view returns (uint256)",
  ],
  TreasuryRouter: [
    "function agentDepositVault() view returns (address)",
    "function azlToken() view returns (address)",
  ],
  ArbitrationModule: ["function MAX_TIERS() view returns (uint256)"],
} as const;

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw last;
}

async function pause(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

function loadArtifact(name: string) {
  const path = join(__dirname, "../artifacts/src", `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as { abi: ethers.InterfaceAbi };
}

async function main() {
  const rpc = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
  const provider = new ethers.JsonRpcProvider(rpc);
  let failed = 0;

  console.log("[fork-check] RPC:", rpc);

  for (const name of CONTRACT_KEYS) {
    const addr = manifest[name];
    const code = await withRetry(() => provider.getCode(addr));
    if (code === "0x") {
      console.error(`✗ ${name} has no bytecode at ${addr}`);
      failed += 1;
    } else {
      console.log(`✓ ${name} bytecode present`);
    }
    await pause();
  }

  const registry = new ethers.Contract(
    manifest.TaskRegistry,
    READ_ABI.TaskRegistry,
    provider
  );
  const escrow = new ethers.Contract(manifest.EscrowVault, READ_ABI.EscrowVault, provider);
  const vault = new ethers.Contract(
    manifest.AgentDepositVault,
    READ_ABI.AgentDepositVault,
    provider
  );
  const treasury = new ethers.Contract(
    manifest.TreasuryRouter,
    READ_ABI.TreasuryRouter,
    provider
  );
  const arbitration = new ethers.Contract(
    manifest.ArbitrationModule,
    READ_ABI.ArbitrationModule,
    provider
  );

  const checks: Array<[string, () => Promise<boolean>]> = [
    [
      "TaskRegistry.arbitration",
      async () => eqAddr(await registry.arbitration(), manifest.ArbitrationModule),
    ],
    [
      "TaskRegistry.treasury",
      async () => eqAddr(await registry.treasury(), manifest.TreasuryRouter),
    ],
    [
      "TaskRegistry.agentVault",
      async () => eqAddr(await registry.agentVault(), manifest.AgentDepositVault),
    ],
    [
      "EscrowVault.taskRegistry",
      async () => eqAddr(await escrow.taskRegistry(), manifest.TaskRegistry),
    ],
    [
      "EscrowVault.arbitrationModule",
      async () => eqAddr(await escrow.arbitrationModule(), manifest.ArbitrationModule),
    ],
    [
      "TreasuryRouter.agentDepositVault",
      async () => eqAddr(await treasury.agentDepositVault(), manifest.AgentDepositVault),
    ],
    [
      "TreasuryRouter.azlToken",
      async () => eqAddr(await treasury.azlToken(), manifest.azlToken),
    ],
    ["ArbitrationModule.MAX_TIERS", async () => (await arbitration.MAX_TIERS()) === 3n],
    [
      "AgentDepositVault.MIN_ENTRY_BALANCE",
      async () => (await vault.MIN_ENTRY_BALANCE()) === 20_000_000n,
    ],
  ];

  for (const [label, fn] of checks) {
    try {
      const ok = await withRetry(fn);
      if (ok) {
        console.log(`✓ ${label}`);
      } else {
        console.error(`✗ ${label} mismatch`);
        failed += 1;
      }
    } catch (err) {
      console.error(`✗ ${label}:`, err instanceof Error ? err.message : err);
      failed += 1;
    }
    await pause();
  }

  for (const [name, fn] of [
    ["AgentDepositVault.topUp", "topUp"],
    ["ArbitrationModule.resolveDispute", "resolveDispute"],
    ["ArbitrationModule.escalate", "escalate"],
  ] as const) {
    const artifact = loadArtifact(name.split(".")[0]!);
    const iface = new ethers.Interface(artifact.abi);
    if (iface.getFunction(fn)) {
      console.log(`✓ ${name} in compiled ABI`);
    } else {
      console.error(`✗ ${name} missing from compiled ABI`);
      failed += 1;
    }
  }

  if (failed > 0) {
    console.error(`\n[fork-check] ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\n[fork-check] manifest matches live Base deployment");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

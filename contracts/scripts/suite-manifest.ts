import fs from "node:fs";
import path from "node:path";
import { ethers } from "hardhat";

export const SUITE_CONTRACTS = [
  "EscrowVault",
  "TaskRegistry",
  "ReputationRegistry",
  "ArbitrationModule",
  "ArbitrationSatellite",
  "ArbitrationRecoveryCoordinator",
  "TreasuryRouter",
  "AgentDepositVault",
  "UnionStakingVault",
  "TaskScopeRegistry",
] as const;

export type SuiteContractName = (typeof SUITE_CONTRACTS)[number];

export type SuiteManifest = {
  chainId: string;
  network: string;
  usdc: string;
  azlToken: string;
  feeRecipient: string;
  buybackExecutor: string;
  fallbackResolver: string;
  deployer: string;
} & Record<SuiteContractName, string>;

export const CANONICAL_MANIFEST = path.join(
  __dirname,
  "..",
  "deployments",
  "base-8453.json"
);

export function candidateManifestPath(): string {
  const configured = process.env.CANDIDATE_MANIFEST_PATH?.trim();
  return configured
    ? path.resolve(process.cwd(), configured)
    : path.join(__dirname, "..", "deployments", "base-8453.candidate.json");
}

export function sameAddress(actual: string, expected: string): boolean {
  return actual.toLowerCase() === expected.toLowerCase();
}

export function requireAddress(label: string, value: string | undefined): string {
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${label} must be a valid nonzero address`);
  }
  return ethers.getAddress(value);
}

export function manifestFromEnv(network: string, chainId: bigint): SuiteManifest {
  const read = (key: string) => requireAddress(key, process.env[key]?.trim());
  return {
    chainId: chainId.toString(),
    network,
    usdc: read("USDC_ADDRESS"),
    azlToken: read("AZL_TOKEN_ADDRESS"),
    feeRecipient: read("FEE_RECIPIENT"),
    buybackExecutor: read("BUYBACK_EXECUTOR"),
    fallbackResolver: read("FALLBACK_RESOLVER"),
    deployer: read("DEPLOYER_ADDRESS"),
    EscrowVault: read("ESCROW_VAULT_ADDRESS"),
    TaskRegistry: read("TASK_REGISTRY_ADDRESS"),
    ReputationRegistry: read("REPUTATION_REGISTRY_ADDRESS"),
    ArbitrationModule: read("ARBITRATION_MODULE_ADDRESS"),
    ArbitrationSatellite: read("ARBITRATION_SATELLITE_ADDRESS"),
    ArbitrationRecoveryCoordinator: read("ARBITRATION_RECOVERY_COORDINATOR_ADDRESS"),
    TreasuryRouter: read("TREASURY_ROUTER_ADDRESS"),
    AgentDepositVault: read("AGENT_DEPOSIT_VAULT_ADDRESS"),
    UnionStakingVault: read("UNION_STAKING_VAULT_ADDRESS"),
    TaskScopeRegistry: read("TASK_SCOPE_REGISTRY_ADDRESS"),
  };
}

export function validateManifestSchema(value: unknown): SuiteManifest {
  if (!value || typeof value !== "object") throw new Error("Manifest must be an object");
  const d = value as Record<string, unknown>;
  for (const key of [
    "chainId",
    "network",
    "usdc",
    "azlToken",
    "feeRecipient",
    "buybackExecutor",
    "fallbackResolver",
    "deployer",
    ...SUITE_CONTRACTS,
  ]) {
    if (typeof d[key] !== "string" || !(d[key] as string).trim()) {
      throw new Error(`Manifest is missing string field ${key}`);
    }
  }
  for (const key of [
    "usdc",
    "azlToken",
    "feeRecipient",
    "buybackExecutor",
    "fallbackResolver",
    "deployer",
    ...SUITE_CONTRACTS,
  ]) {
    requireAddress(`manifest.${key}`, d[key] as string);
  }
  return value as SuiteManifest;
}

async function assertCode(name: string, address: string): Promise<void> {
  // Public RPC endpoints can briefly route receipt and state reads to backends
  // at different heads. Retry before declaring a confirmed deployment absent.
  for (let attempt = 1; attempt <= 12; attempt++) {
    if ((await ethers.provider.getCode(address)) !== "0x") return;
    if (attempt < 12) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  throw new Error(`${name} has no deployed bytecode at ${address} after 12 attempts`);
}

async function assertAddress(label: string, actual: Promise<string>, expected: string) {
  const value = await actual;
  if (!sameAddress(value, expected)) {
    throw new Error(`${label} is ${value}, expected ${expected}`);
  }
}

/** Validate bytecode, constructor immutables, and every one-shot wiring edge. */
export async function validateCompleteSuite(d: SuiteManifest): Promise<void> {
  const network = await ethers.provider.getNetwork();
  if (network.chainId.toString() !== d.chainId) {
    throw new Error(`Connected chain ${network.chainId}, manifest chain ${d.chainId}`);
  }
  // Keep validation sequential so public RPC rate limits cannot turn a valid
  // deployment into a false negative during the final manifest check.
  for (const name of SUITE_CONTRACTS) {
    await assertCode(name, d[name]);
  }
  await assertCode("USDC", d.usdc);
  await assertCode("AZL token", d.azlToken);

  const escrow = await ethers.getContractAt("EscrowVault", d.EscrowVault);
  const registry = await ethers.getContractAt("TaskRegistry", d.TaskRegistry);
  const reputation = await ethers.getContractAt("ReputationRegistry", d.ReputationRegistry);
  const arbitration = await ethers.getContractAt("ArbitrationModule", d.ArbitrationModule);
  const recovery = await ethers.getContractAt(
    "ArbitrationRecoveryCoordinator",
    d.ArbitrationRecoveryCoordinator
  );
  const treasury = await ethers.getContractAt("TreasuryRouter", d.TreasuryRouter);
  const vault = await ethers.getContractAt("AgentDepositVault", d.AgentDepositVault);
  const staking = await ethers.getContractAt("UnionStakingVault", d.UnionStakingVault);
  const scope = await ethers.getContractAt("TaskScopeRegistry", d.TaskScopeRegistry);

  const checks: Array<[string, () => Promise<string>, string]> = [
    ["EscrowVault.taskRegistry", () => escrow.taskRegistry(), d.TaskRegistry],
    ["EscrowVault.arbitrationModule", () => escrow.arbitrationModule(), d.ArbitrationModule],
    ["EscrowVault.recovery", () => escrow.arbitrationRecoveryCoordinator(), d.ArbitrationRecoveryCoordinator],
    ["TaskRegistry.escrow", () => registry.escrow(), d.EscrowVault],
    ["TaskRegistry.arbitration", () => registry.arbitration(), d.ArbitrationModule],
    ["TaskRegistry.treasury", () => registry.treasury(), d.TreasuryRouter],
    ["TaskRegistry.agentVault", () => registry.agentVault(), d.AgentDepositVault],
    ["TaskRegistry.reputation", () => registry.reputation(), d.ReputationRegistry],
    ["TaskRegistry.recovery", () => registry.arbitrationRecoveryCoordinator(), d.ArbitrationRecoveryCoordinator],
    ["TaskRegistry.stakingVault", () => registry.stakingVault(), d.UnionStakingVault],
    ["ReputationRegistry.taskRegistry", () => reputation.taskRegistry(), d.TaskRegistry],
    ["ReputationRegistry.arbitrationModule", () => reputation.arbitrationModule(), d.ArbitrationModule],
    ["ReputationRegistry.agentDepositVault", () => reputation.agentDepositVault(), d.AgentDepositVault],
    ["ReputationRegistry.treasury", () => reputation.treasury(), d.TreasuryRouter],
    ["ReputationRegistry.recovery", () => reputation.arbitrationRecoveryCoordinator(), d.ArbitrationRecoveryCoordinator],
    ["ArbitrationModule.taskRegistry", () => arbitration.taskRegistry(), d.TaskRegistry],
    ["ArbitrationModule.escrow", () => arbitration.escrow(), d.EscrowVault],
    ["ArbitrationModule.reputationRegistry", () => arbitration.reputationRegistry(), d.ReputationRegistry],
    ["ArbitrationModule.agentDepositVault", () => arbitration.agentDepositVault(), d.AgentDepositVault],
    ["ArbitrationModule.fallbackResolver", () => arbitration.fallbackResolver(), d.fallbackResolver],
    ["ArbitrationModule.arbitrationSatellite", () => arbitration.arbitrationSatellite(), d.ArbitrationSatellite],
    ["ReputationRegistry.arbitrationSatellite", () => reputation.arbitrationSatellite(), d.ArbitrationSatellite],
    ["TreasuryRouter.taskRegistry", () => treasury.taskRegistry(), d.TaskRegistry],
    ["TreasuryRouter.feeRecipient", () => treasury.feeRecipient(), d.feeRecipient],
    ["TreasuryRouter.reputationRegistry", () => treasury.reputationRegistry(), d.ReputationRegistry],
    ["TreasuryRouter.agentDepositVault", () => treasury.agentDepositVault(), d.AgentDepositVault],
    ["TreasuryRouter.azlToken", () => treasury.azlToken(), d.azlToken],
    ["TreasuryRouter.stakingVault", () => treasury.stakingVault(), d.UnionStakingVault],
    ["TreasuryRouter.buybackExecutor", () => treasury.buybackExecutor(), d.buybackExecutor],
    ["AgentDepositVault.usdcToken", () => vault.usdcToken(), d.usdc],
    ["AgentDepositVault.taskRegistry", () => vault.taskRegistry(), d.TaskRegistry],
    ["AgentDepositVault.treasury", () => vault.treasury(), d.TreasuryRouter],
    ["AgentDepositVault.reputationRegistry", () => vault.reputationRegistry(), d.ReputationRegistry],
    ["AgentDepositVault.arbitrationModule", () => vault.arbitrationModule(), d.ArbitrationModule],
    ["AgentDepositVault.recovery", () => vault.arbitrationRecoveryCoordinator(), d.ArbitrationRecoveryCoordinator],
    ["Recovery.taskRegistry", () => recovery.taskRegistry(), d.TaskRegistry],
    ["Recovery.escrow", () => recovery.escrow(), d.EscrowVault],
    ["Recovery.agentDepositVault", () => recovery.agentDepositVault(), d.AgentDepositVault],
    ["Recovery.reputationRegistry", () => recovery.reputationRegistry(), d.ReputationRegistry],
    ["UnionStakingVault.azlToken", () => staking.azlToken(), d.azlToken],
    ["UnionStakingVault.usdcToken", () => staking.usdcToken(), d.usdc],
    ["UnionStakingVault.taskRegistry", () => staking.taskRegistry(), d.TaskRegistry],
    ["UnionStakingVault.treasury", () => staking.treasury(), d.TreasuryRouter],
    ["TaskScopeRegistry.taskRegistry", () => scope.taskRegistry(), d.TaskRegistry],
  ];
  for (const [label, read, expected] of checks) {
    await assertAddress(label, read(), expected);
  }

  const satellite = await ethers.getContractAt("ArbitrationSatellite", d.ArbitrationSatellite);
  await assertAddress(
    "ArbitrationSatellite.arbitrationModule",
    satellite.arbitrationModule(),
    d.ArbitrationModule
  );
  await assertAddress(
    "ArbitrationSatellite.reputationRegistry",
    satellite.reputationRegistry(),
    d.ReputationRegistry
  );
}

export async function writeValidatedCandidate(d: SuiteManifest): Promise<string> {
  validateManifestSchema(d);
  await validateCompleteSuite(d);
  const output = candidateManifestPath();
  if (path.resolve(output) === path.resolve(CANONICAL_MANIFEST)) {
    throw new Error("Candidate path resolves to canonical live manifest; refusing overwrite");
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (fs.existsSync(output)) {
    const existing = validateManifestSchema(JSON.parse(fs.readFileSync(output, "utf8")));
    if (JSON.stringify(existing) === JSON.stringify(d)) return output;
    throw new Error(
      `Candidate already exists with different content: ${output}. Archive or choose CANDIDATE_MANIFEST_PATH`
    );
  }
  fs.writeFileSync(output, JSON.stringify(d, null, 2) + "\n", { flag: "wx" });
  return output;
}

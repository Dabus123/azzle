/**
 * Validate deploy wiring order before sending transactions.
 *
 * Usage:
 *   npx hardhat run scripts/preflight-deploy.ts --network base          # inspect live wiring
 *   npx hardhat run scripts/preflight-deploy.ts --network base -- --dry-run
 *
 * Set the complete deployed graph in .env (see .env.example).
 */
import { ethers } from "hardhat";
import { isZero } from "./deploy-utils";

interface WiringStep {
  id: string;
  description: string;
  check: () => Promise<boolean>;
  /** Required before AgentDepositVault.wire() */
  beforeWire?: boolean;
}

async function readAddr(getter: () => Promise<string>): Promise<string> {
  try {
    return await getter();
  } catch {
    return ethers.ZeroAddress;
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const escrowAddress = process.env.ESCROW_VAULT_ADDRESS?.trim();
  const registryAddress = process.env.TASK_REGISTRY_ADDRESS?.trim();
  const reputationAddress = process.env.REPUTATION_REGISTRY_ADDRESS?.trim();
  const arbitrationAddress = process.env.ARBITRATION_MODULE_ADDRESS?.trim();
  const treasuryAddress = process.env.TREASURY_ROUTER_ADDRESS?.trim();
  const agentVaultAddress = process.env.AGENT_DEPOSIT_VAULT_ADDRESS?.trim();
  const recoveryAddress = process.env.ARBITRATION_RECOVERY_COORDINATOR_ADDRESS?.trim();
  const stakingAddress = process.env.UNION_STAKING_VAULT_ADDRESS?.trim();
  const taskScopeAddress = process.env.TASK_SCOPE_REGISTRY_ADDRESS?.trim();
  const azlToken = process.env.AZL_TOKEN_ADDRESS?.trim();
  const usdc = process.env.USDC_ADDRESS?.trim() ??
    ((process.env.HARDHAT_NETWORK ?? "") === "base"
      ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
      : undefined);
  const buybackExecutor = process.env.BUYBACK_EXECUTOR?.trim();
  const fallbackResolver = process.env.FALLBACK_RESOLVER?.trim();

  const required = {
    ESCROW_VAULT_ADDRESS: escrowAddress,
    TASK_REGISTRY_ADDRESS: registryAddress,
    REPUTATION_REGISTRY_ADDRESS: reputationAddress,
    ARBITRATION_MODULE_ADDRESS: arbitrationAddress,
    TREASURY_ROUTER_ADDRESS: treasuryAddress,
    AGENT_DEPOSIT_VAULT_ADDRESS: agentVaultAddress,
    ARBITRATION_RECOVERY_COORDINATOR_ADDRESS: recoveryAddress,
    UNION_STAKING_VAULT_ADDRESS: stakingAddress,
    TASK_SCOPE_REGISTRY_ADDRESS: taskScopeAddress,
    AZL_TOKEN_ADDRESS: azlToken,
    USDC_ADDRESS: usdc,
    BUYBACK_EXECUTOR: buybackExecutor,
    FALLBACK_RESOLVER: fallbackResolver,
  };
  const missing = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length > 0) {
    throw new Error(`Complete wiring preflight requires: ${missing.join(", ")}`);
  }

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress!);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress!);

  const reputation = reputationAddress
    ? await ethers.getContractAt("ReputationRegistry", reputationAddress)
    : null;
  const arbitration = arbitrationAddress
    ? await ethers.getContractAt("ArbitrationModule", arbitrationAddress)
    : null;
  const treasury = treasuryAddress
    ? await ethers.getContractAt("TreasuryRouter", treasuryAddress)
    : null;
  const agentVault = agentVaultAddress
    ? await ethers.getContractAt("AgentDepositVault", agentVaultAddress)
    : null;
  const recovery = await ethers.getContractAt(
    "ArbitrationRecoveryCoordinator",
    recoveryAddress!
  );
  const staking = await ethers.getContractAt("UnionStakingVault", stakingAddress!);
  const taskScope = await ethers.getContractAt("TaskScopeRegistry", taskScopeAddress!);

  for (const [name, address] of Object.entries({
    EscrowVault: escrowAddress,
    TaskRegistry: registryAddress,
    ReputationRegistry: reputationAddress,
    ArbitrationModule: arbitrationAddress,
    TreasuryRouter: treasuryAddress,
    AgentDepositVault: agentVaultAddress,
    ArbitrationRecoveryCoordinator: recoveryAddress,
    UnionStakingVault: stakingAddress,
    TaskScopeRegistry: taskScopeAddress,
  })) {
    if ((await ethers.provider.getCode(address!)) === "0x") {
      throw new Error(`${name} has no deployed code at ${address}`);
    }
  }

  const steps: WiringStep[] = [
    {
      id: "registry.setReputation",
      description: "TaskRegistry.reputation → ReputationRegistry",
      check: async () =>
        (await readAddr(() => registry.reputation())).toLowerCase() ===
        reputationAddress!.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "escrow.setTaskRegistry",
      description: "EscrowVault.taskRegistry → TaskRegistry",
      check: async () =>
        (await readAddr(() => escrow.taskRegistry())).toLowerCase() ===
        registryAddress!.toLowerCase(),
    },
    {
      id: "agentVault.setArbitrationModule",
      description: "AgentDepositVault.arbitrationModule → ArbitrationModule",
      check: async () =>
        (await readAddr(() => agentVault!.arbitrationModule())).toLowerCase() ===
        arbitrationAddress!.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "arbitration.setFallbackResolver",
      description: "ArbitrationModule.fallbackResolver → approved resolver",
      check: async () =>
        (await readAddr(() => arbitration!.fallbackResolver())).toLowerCase() ===
        fallbackResolver!.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "registry.setArbitration",
      description: "TaskRegistry.arbitration → ArbitrationModule",
      check: async () =>
        !arbitrationAddress ||
        (await readAddr(() => registry.arbitration())).toLowerCase() ===
          arbitrationAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "registry.setTreasury",
      description: "TaskRegistry.treasury → TreasuryRouter",
      check: async () =>
        !treasuryAddress ||
        (await readAddr(() => registry.treasury())).toLowerCase() === treasuryAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "registry.setAgentVault",
      description: "TaskRegistry.agentVault → AgentDepositVault",
      check: async () =>
        !agentVaultAddress ||
        (await readAddr(() => registry.agentVault())).toLowerCase() ===
          agentVaultAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "escrow.setArbitrationModule",
      description: "EscrowVault.arbitrationModule → ArbitrationModule",
      check: async () =>
        !arbitrationAddress ||
        (await readAddr(() => escrow.arbitrationModule())).toLowerCase() ===
          arbitrationAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "reputation.setAuthorized",
      description: "ReputationRegistry authorized registry + arbitration",
      check: async () => {
        if (!reputation) return false;
        const regOk =
          (await readAddr(() => reputation.taskRegistry())).toLowerCase() ===
          registryAddress!.toLowerCase();
        const arbOk =
          !arbitrationAddress ||
          (await readAddr(() => reputation.arbitrationModule())).toLowerCase() ===
            arbitrationAddress.toLowerCase();
        return regOk && arbOk;
      },
      beforeWire: true,
    },
    {
      id: "reputation.setAgentDepositVault",
      description: "ReputationRegistry.agentDepositVault → AgentDepositVault",
      check: async () =>
        !reputation ||
        !agentVaultAddress ||
        (await readAddr(() => reputation.agentDepositVault())).toLowerCase() ===
          agentVaultAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "arbitration.setReputationRegistry",
      description: "ArbitrationModule.reputationRegistry → ReputationRegistry",
      check: async () =>
        !arbitration ||
        !reputationAddress ||
        (await readAddr(() => arbitration.reputationRegistry())).toLowerCase() ===
          reputationAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "arbitration.setAgentDepositVault",
      description: "ArbitrationModule.agentDepositVault → AgentDepositVault",
      check: async () =>
        !arbitration ||
        !agentVaultAddress ||
        (await readAddr(() => arbitration.agentDepositVault())).toLowerCase() ===
          agentVaultAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "arbitration.setArbitrationSatellite",
      description: "ArbitrationModule + ReputationRegistry → ArbitrationSatellite",
      check: async () => {
        if (!arbitration || !reputation) return false;
        const modSat = await readAddr(() => arbitration.arbitrationSatellite());
        const repSat = await readAddr(() => reputation.arbitrationSatellite());
        return !isZero(modSat) && modSat.toLowerCase() === repSat.toLowerCase();
      },
      beforeWire: true,
    },
    {
      id: "reputation.setTreasury",
      description: "ReputationRegistry.treasury → TreasuryRouter",
      check: async () =>
        !reputation ||
        !treasuryAddress ||
        (await readAddr(() => reputation.treasury())).toLowerCase() ===
          treasuryAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "treasury.setReputationRegistry",
      description: "TreasuryRouter.reputationRegistry → ReputationRegistry",
      check: async () =>
        !treasury ||
        !reputationAddress ||
        (await readAddr(() => treasury.reputationRegistry())).toLowerCase() ===
          reputationAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "treasury.setAgentDepositVault",
      description: "TreasuryRouter.agentDepositVault → AgentDepositVault (MUST precede wire())",
      check: async () =>
        !treasury ||
        !agentVaultAddress ||
        (await readAddr(() => treasury.agentDepositVault())).toLowerCase() ===
          agentVaultAddress.toLowerCase(),
      beforeWire: true,
    },
    {
      id: "agentVault.wire",
      description: "AgentDepositVault.wire(registry, treasury, reputation)",
      check: async () => {
        if (!agentVault) return false;
        const tr = await readAddr(() => agentVault.taskRegistry());
        const tw = await readAddr(() => agentVault.treasury());
        const rr = await readAddr(() => agentVault.reputationRegistry());
        return (
          tr.toLowerCase() === registryAddress!.toLowerCase() &&
          (!treasuryAddress || tw.toLowerCase() === treasuryAddress.toLowerCase()) &&
          (!reputationAddress || rr.toLowerCase() === reputationAddress.toLowerCase())
        );
      },
    },
    {
      id: "treasury.setAzlToken",
      description: "TreasuryRouter.azlToken → live AZZLE token",
      check: async () =>
        !treasury ||
        !azlToken ||
        (await readAddr(() => treasury.azlToken())).toLowerCase() === azlToken.toLowerCase(),
    },
    ...([
      ["registry", registry, "arbitrationRecoveryCoordinator"],
      ["escrow", escrow, "arbitrationRecoveryCoordinator"],
      ["agentVault", agentVault!, "arbitrationRecoveryCoordinator"],
      ["reputation", reputation!, "arbitrationRecoveryCoordinator"],
    ] as const).map(([name, contract, getter]) => ({
      id: `${name}.setArbitrationRecoveryCoordinator`,
      description: `${name}.${getter} → ArbitrationRecoveryCoordinator`,
      check: async () =>
        (await readAddr(() => contract[getter]())).toLowerCase() ===
        recoveryAddress!.toLowerCase(),
    })),
    {
      id: "recovery.immutableGraph",
      description: "ArbitrationRecoveryCoordinator immutables → core graph",
      check: async () =>
        (await readAddr(() => recovery.taskRegistry())).toLowerCase() === registryAddress!.toLowerCase() &&
        (await readAddr(() => recovery.escrow())).toLowerCase() === escrowAddress!.toLowerCase() &&
        (await readAddr(() => recovery.agentDepositVault())).toLowerCase() === agentVaultAddress!.toLowerCase() &&
        (await readAddr(() => recovery.reputationRegistry())).toLowerCase() === reputationAddress!.toLowerCase(),
    },
    {
      id: "staking.graph",
      description: "UnionStakingVault registry, treasury, and tokens",
      check: async () =>
        (await readAddr(() => staking.taskRegistry())).toLowerCase() === registryAddress!.toLowerCase() &&
        (await readAddr(() => staking.treasury())).toLowerCase() === treasuryAddress!.toLowerCase() &&
        (await readAddr(() => staking.azlToken())).toLowerCase() === azlToken!.toLowerCase() &&
        (await readAddr(() => staking.usdcToken())).toLowerCase() === usdc!.toLowerCase(),
    },
    {
      id: "registry.setStakingVault",
      description: "TaskRegistry.stakingVault → UnionStakingVault",
      check: async () =>
        (await readAddr(() => registry.stakingVault())).toLowerCase() === stakingAddress!.toLowerCase(),
    },
    {
      id: "treasury.setStakingVault",
      description: "TreasuryRouter.stakingVault → UnionStakingVault",
      check: async () =>
        (await readAddr(() => treasury!.stakingVault())).toLowerCase() === stakingAddress!.toLowerCase(),
    },
    {
      id: "treasury.setBuybackExecutor",
      description: "TreasuryRouter.buybackExecutor → explicit executor",
      check: async () =>
        (await readAddr(() => treasury!.buybackExecutor())).toLowerCase() === buybackExecutor!.toLowerCase(),
    },
    {
      id: "taskScope.taskRegistry",
      description: "TaskScopeRegistry.taskRegistry → TaskRegistry",
      check: async () =>
        (await readAddr(() => taskScope.taskRegistry())).toLowerCase() ===
        registryAddress!.toLowerCase(),
    },
    {
      id: "governance.guardianSplit",
      description: "Guardian rotated away from owner on all RecoverableOwnable2Step contracts (Finding 9)",
      check: async () => {
        const contracts = [
          ["TreasuryRouter", treasury],
          ["ArbitrationModule", arbitration],
          ["AgentDepositVault", agentVault],
          ["EscrowVault", escrow],
          ["TaskRegistry", registry],
          ["ReputationRegistry", reputation],
          ["UnionStakingVault", staking],
          ["TaskScopeRegistry", taskScope],
        ] as const;
        for (const [name, c] of contracts) {
          if (!c) return false;
          const g = await readAddr(() => c.guardian());
          const o = await readAddr(() => c.owner());
          if (g.toLowerCase() === o.toLowerCase()) {
            console.log(`   ⚠ ${name}: guardian still equals owner — override/recovery paths inert`);
            return false;
          }
        }
        return true;
      },
    },
  ];

  console.log(dryRun ? "[preflight] DRY RUN — no transactions will be sent\n" : "[preflight] Wiring audit\n");

  const pending: WiringStep[] = [];
  for (const step of steps) {
    const ok = await step.check();
    console.log(`${ok ? "✓" : "✗"} ${step.id}: ${step.description}`);
    if (!ok) pending.push(step);
  }

  const wirePending = pending.some((s) => s.id === "agentVault.wire");
  const beforeWirePending = pending.filter((s) => s.beforeWire);

  if (wirePending && beforeWirePending.length > 0) {
    console.log("\n⚠ wire() footgun: complete these BEFORE agentVault.wire():");
    for (const s of beforeWirePending) {
      console.log(`   → ${s.id}`);
    }
    console.log(
      "\n   wire() does NOT configure TreasuryRouter. setAgentDepositVault on treasury first."
    );
  }

  if (pending.length === 0) {
    console.log("\n[preflight] Wiring complete — safe to operate.");
    return;
  }

  console.log(`\n[preflight] ${pending.length} step(s) remaining:`);
  for (const s of pending) {
    console.log(`   → ${s.id}: ${s.description}`);
  }

  if (dryRun) {
    console.log("\n[preflight] Dry run finished. Fix order above before broadcasting txs.");
    process.exitCode = 1;
    return;
  }

  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

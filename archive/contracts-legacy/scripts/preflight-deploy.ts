/**
 * Validate deploy wiring order before sending transactions.
 *
 * Usage:
 *   npx hardhat run scripts/preflight-deploy.ts --network base          # inspect live wiring
 *   npx hardhat run scripts/preflight-deploy.ts --network base -- --dry-run
 *
 * Set contract addresses in .env (see .env.example). Omit addresses for steps not yet deployed.
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
  const azlToken = process.env.AZL_TOKEN_ADDRESS?.trim();

  if (!escrowAddress || !registryAddress) {
    throw new Error("ESCROW_VAULT_ADDRESS and TASK_REGISTRY_ADDRESS required");
  }

  const escrow = await ethers.getContractAt("EscrowVault", escrowAddress);
  const registry = await ethers.getContractAt("TaskRegistry", registryAddress);

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

  const steps: WiringStep[] = [
    {
      id: "escrow.setTaskRegistry",
      description: "EscrowVault.taskRegistry → TaskRegistry",
      check: async () =>
        (await readAddr(() => escrow.taskRegistry())).toLowerCase() ===
        registryAddress!.toLowerCase(),
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

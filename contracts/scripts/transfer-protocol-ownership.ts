/**
 * Post-deployment ownership handoff.
 *
 * Proposes PROTOCOL_OWNER (or BUYBACK_EXECUTOR) as owner of every Ownable2Step
 * protocol contract after validating the deployed graph. The recipient must
 * execute acceptOwnership() on each contract to complete the handoff.
 *
 * When guardian still equals the outgoing owner at accept time, acceptOwnership()
 * resets guardian to the incoming owner automatically. A deliberately separated
 * guardian (rotated before handoff) is preserved.
 *
 * Usage:
 *   npm run ownership:transfer -- --network base
 *
 * Set PROTOCOL_OWNER to the governance Safe. BUYBACK_EXECUTOR is accepted as a
 * fallback for existing deployments, but separating governance and operations
 * is recommended.
 */
import fs from "fs";
import path from "path";
import { ethers } from "hardhat";
import { confirm, isZero } from "./deploy-utils";
import { SuiteManifest, validateCompleteSuite } from "./suite-manifest";

const MANIFEST_PATH = path.join(__dirname, "..", "deployments", "base-8453.json");

type Manifest = SuiteManifest;

const OWNABLE_CONTRACTS = [
  "EscrowVault",
  "TaskRegistry",
  "ReputationRegistry",
  "ArbitrationModule",
  "ArbitrationRecoveryCoordinator",
  "TreasuryRouter",
  "AgentDepositVault",
  "UnionStakingVault",
] as const;

/** Full suite bytecode check before handoff (includes ownerless contracts). */
const DEPLOYED_SUITE = [
  ...OWNABLE_CONTRACTS,
  "ArbitrationSatellite",
  "TaskScopeRegistry",
] as const;

type OwnableName = (typeof OWNABLE_CONTRACTS)[number];

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function assertAddress(label: string, value: string | undefined): string {
  if (!value || !ethers.isAddress(value) || isZero(value)) {
    throw new Error(`${label} must be a nonzero address`);
  }
  return ethers.getAddress(value);
}

function assertSame(label: string, actual: string, expected: string) {
  if (!sameAddress(actual, expected)) {
    throw new Error(`${label} is ${actual}, expected ${expected}`);
  }
}

async function assertContract(label: string, address: string) {
  if ((await ethers.provider.getCode(address)) === "0x") {
    throw new Error(`${label} has no deployed code at ${address}`);
  }
}

async function validateFinishedDeployment(d: Manifest) {
  await validateCompleteSuite(d);
  const escrow = await ethers.getContractAt("EscrowVault", d.EscrowVault);
  const registry = await ethers.getContractAt("TaskRegistry", d.TaskRegistry);
  const reputation = await ethers.getContractAt("ReputationRegistry", d.ReputationRegistry);
  const arbitration = await ethers.getContractAt("ArbitrationModule", d.ArbitrationModule);
  const recovery = await ethers.getContractAt(
    "ArbitrationRecoveryCoordinator",
    d.ArbitrationRecoveryCoordinator
  );
  const treasury = await ethers.getContractAt("TreasuryRouter", d.TreasuryRouter);
  const agentVault = await ethers.getContractAt("AgentDepositVault", d.AgentDepositVault);
  const staking = await ethers.getContractAt("UnionStakingVault", d.UnionStakingVault);
  const scope = await ethers.getContractAt("TaskScopeRegistry", d.TaskScopeRegistry);

  assertSame("EscrowVault.taskRegistry", await escrow.taskRegistry(), d.TaskRegistry);
  assertSame("EscrowVault.arbitrationModule", await escrow.arbitrationModule(), d.ArbitrationModule);
  assertSame(
    "EscrowVault.arbitrationRecoveryCoordinator",
    await escrow.arbitrationRecoveryCoordinator(),
    d.ArbitrationRecoveryCoordinator
  );
  assertSame("TaskRegistry.arbitration", await registry.arbitration(), d.ArbitrationModule);
  assertSame("TaskRegistry.treasury", await registry.treasury(), d.TreasuryRouter);
  assertSame("TaskRegistry.agentVault", await registry.agentVault(), d.AgentDepositVault);
  assertSame("TaskRegistry.reputation", await registry.reputation(), d.ReputationRegistry);
  assertSame("TaskRegistry.stakingVault", await registry.stakingVault(), d.UnionStakingVault);
  assertSame(
    "TaskRegistry.arbitrationRecoveryCoordinator",
    await registry.arbitrationRecoveryCoordinator(),
    d.ArbitrationRecoveryCoordinator
  );
  assertSame("ReputationRegistry.taskRegistry", await reputation.taskRegistry(), d.TaskRegistry);
  assertSame(
    "ReputationRegistry.arbitrationModule",
    await reputation.arbitrationModule(),
    d.ArbitrationModule
  );
  assertSame(
    "ReputationRegistry.agentDepositVault",
    await reputation.agentDepositVault(),
    d.AgentDepositVault
  );
  assertSame("ReputationRegistry.treasury", await reputation.treasury(), d.TreasuryRouter);
  assertSame(
    "ReputationRegistry.arbitrationRecoveryCoordinator",
    await reputation.arbitrationRecoveryCoordinator(),
    d.ArbitrationRecoveryCoordinator
  );
  assertSame(
    "ArbitrationModule.reputationRegistry",
    await arbitration.reputationRegistry(),
    d.ReputationRegistry
  );
  assertSame(
    "ArbitrationModule.agentDepositVault",
    await arbitration.agentDepositVault(),
    d.AgentDepositVault
  );
  assertSame(
    "ArbitrationModule.fallbackResolver",
    await arbitration.fallbackResolver(),
    d.fallbackResolver
  );
  assertSame(
    "ArbitrationModule.arbitrationSatellite",
    await arbitration.arbitrationSatellite(),
    d.ArbitrationSatellite
  );
  assertSame(
    "ReputationRegistry.arbitrationSatellite",
    await reputation.arbitrationSatellite(),
    d.ArbitrationSatellite
  );
  const satellite = await ethers.getContractAt("ArbitrationSatellite", d.ArbitrationSatellite);
  assertSame(
    "ArbitrationSatellite.arbitrationModule",
    await satellite.arbitrationModule(),
    d.ArbitrationModule
  );
  assertSame(
    "ArbitrationSatellite.reputationRegistry",
    await satellite.reputationRegistry(),
    d.ReputationRegistry
  );
  assertSame("TreasuryRouter.agentDepositVault", await treasury.agentDepositVault(), d.AgentDepositVault);
  assertSame("TreasuryRouter.reputationRegistry", await treasury.reputationRegistry(), d.ReputationRegistry);
  assertSame("TreasuryRouter.azlToken", await treasury.azlToken(), d.azlToken);
  assertSame("TreasuryRouter.stakingVault", await treasury.stakingVault(), d.UnionStakingVault);
  assertSame("TreasuryRouter.buybackExecutor", await treasury.buybackExecutor(), d.buybackExecutor);
  assertSame("AgentDepositVault.taskRegistry", await agentVault.taskRegistry(), d.TaskRegistry);
  assertSame("AgentDepositVault.treasury", await agentVault.treasury(), d.TreasuryRouter);
  assertSame(
    "AgentDepositVault.reputationRegistry",
    await agentVault.reputationRegistry(),
    d.ReputationRegistry
  );
  assertSame(
    "AgentDepositVault.arbitrationModule",
    await agentVault.arbitrationModule(),
    d.ArbitrationModule
  );
  assertSame(
    "AgentDepositVault.arbitrationRecoveryCoordinator",
    await agentVault.arbitrationRecoveryCoordinator(),
    d.ArbitrationRecoveryCoordinator
  );
  assertSame("Recovery.taskRegistry", await recovery.taskRegistry(), d.TaskRegistry);
  assertSame("Recovery.escrow", await recovery.escrow(), d.EscrowVault);
  assertSame("Recovery.agentDepositVault", await recovery.agentDepositVault(), d.AgentDepositVault);
  assertSame("Recovery.reputationRegistry", await recovery.reputationRegistry(), d.ReputationRegistry);
  assertSame("UnionStakingVault.taskRegistry", await staking.taskRegistry(), d.TaskRegistry);
  assertSame("UnionStakingVault.treasury", await staking.treasury(), d.TreasuryRouter);
  assertSame("UnionStakingVault.azlToken", await staking.azlToken(), d.azlToken);
  assertSame("UnionStakingVault.usdcToken", await staking.usdcToken(), d.usdc);
  assertSame("TaskScopeRegistry.taskRegistry", await scope.taskRegistry(), d.TaskRegistry);
  console.log("UnionStakingVault.stakingActive:", await staking.stakingActive());
}

function writeSafeBatch(chainId: bigint, owner: string, d: Manifest) {
  const batch = {
    version: "1.0",
    chainId: chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name: "AZZLE protocol ownership acceptance",
      description: "Accept Ownable2Step ownership after the deployer proposed the governance Safe",
      txBuilderVersion: "1.18.0",
      createdFromSafeAddress: owner,
      checksum: "",
    },
    transactions: OWNABLE_CONTRACTS.map((name) => ({
      to: d[name],
      value: "0",
      data: null,
      contractMethod: {
        inputs: [],
        name: "acceptOwnership",
        payable: false,
      },
      contractInputsValues: {},
    })),
  };
  const output = path.join(__dirname, "..", "deployments", "accept-ownership-safe-batch.json");
  fs.writeFileSync(output, JSON.stringify(batch, null, 2) + "\n");
  return output;
}

async function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Deployment manifest not found: ${MANIFEST_PATH}`);
  }
  const d = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as Manifest;
  const network = await ethers.provider.getNetwork();
  if (network.chainId.toString() !== d.chainId) {
    throw new Error(`Connected chain ${network.chainId}, manifest chain ${d.chainId}`);
  }

  const targetOwner = assertAddress(
    "PROTOCOL_OWNER or BUYBACK_EXECUTOR",
    process.env.PROTOCOL_OWNER?.trim() || process.env.BUYBACK_EXECUTOR?.trim()
  );
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer configured");
  if (sameAddress(targetOwner, deployer.address)) {
    throw new Error("Target owner is the deployer; ownership would not be decentralized");
  }

  for (const name of DEPLOYED_SUITE) {
    assertAddress(name, d[name]);
    await assertContract(name, d[name]);
  }
  const targetCode = await ethers.provider.getCode(targetOwner);
  if (targetCode === "0x" && process.env.ALLOW_EOA_PROTOCOL_OWNER !== "true") {
    throw new Error(
      `Target owner ${targetOwner} is an EOA. Set ALLOW_EOA_PROTOCOL_OWNER=true only if intentional`
    );
  }
  if (targetCode === "0x") {
    console.warn("WARNING: transferring protocol ownership to an EOA");
  }

  console.log("Network chainId:", network.chainId.toString());
  console.log("Current signer:", deployer.address);
  console.log("Proposed protocol owner:", targetOwner);
  console.log("Validating complete deployment graph...");
  await validateFinishedDeployment(d);
  console.log("Deployment graph is complete.");

  const checkOnly = process.argv.includes("--check");
  if (checkOnly) {
    let incomplete = 0;
    for (const name of OWNABLE_CONTRACTS) {
      const contract = await ethers.getContractAt(name, d[name]);
      const owner = await contract.owner();
      const pendingOwner = await contract.pendingOwner();
      const accepted = sameAddress(owner, targetOwner) && isZero(pendingOwner);
      console.log(
        `${accepted ? "✓" : "✗"} ${name}: owner=${owner} pendingOwner=${pendingOwner}`
      );
      if (!accepted) incomplete += 1;
    }
    if (incomplete > 0) {
      throw new Error(`${incomplete} ownership acceptance(s) incomplete`);
    }
    console.log("All ownership acceptances complete.");
    return;
  }

  for (const name of OWNABLE_CONTRACTS) {
    const contract = await ethers.getContractAt(name, d[name]);
    const owner = await contract.owner();
    const pendingOwner = await contract.pendingOwner();
    if (sameAddress(owner, targetOwner)) {
      console.log(`skip ${name}: target already owns contract`);
      continue;
    }
    if (!sameAddress(owner, deployer.address)) {
      throw new Error(`${name}.owner is ${owner}, not signer ${deployer.address}`);
    }
    if (sameAddress(pendingOwner, targetOwner)) {
      console.log(`skip ${name}: target already pending`);
      continue;
    }
    if (!isZero(pendingOwner)) {
      throw new Error(`${name}.pendingOwner is unexpected address ${pendingOwner}`);
    }
    await confirm(`${name}.transferOwnership`, contract.transferOwnership(targetOwner));
    const proposedOwner = await contract.owner();
    const proposedPending = await contract.pendingOwner();
    if (
      !sameAddress(proposedOwner, deployer.address) ||
      !sameAddress(proposedPending, targetOwner)
    ) {
      throw new Error(
        `${name} post-proposal state invalid: owner=${proposedOwner}, pendingOwner=${proposedPending}`
      );
    }
  }

  const batchPath = writeSafeBatch(network.chainId, targetOwner, d);
  console.log("\nOwnership proposals complete.");
  console.log(
    "ArbitrationSatellite and TaskScopeRegistry are ownerless — no acceptOwnership in the Safe batch."
  );
  console.log(`Import this Safe Transaction Builder batch to accept ownership:\n${batchPath}`);
  console.log("Ownership is NOT transferred until the target executes all acceptOwnership calls.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Deploy TaskScopeRegistry on Base (or any network with TaskRegistry wired in manifest).
 *
 * Requires contracts/.env:
 *   BASE_RPC_URL=https://...
 *   DEPLOYER_PRIVATE_KEY=0x...
 *
 * Optional override:
 *   TASK_REGISTRY_ADDRESS=0x0A47C3A2D515EC3a23f225A7bAC1b0A1654e4D48
 *
 * Usage:
 *   npx hardhat run scripts/deploy-task-scope-registry.ts --network base
 */
import fs from "fs";
import path from "path";
import { ethers } from "hardhat";

const MANIFEST_PATH = path.join(__dirname, "..", "deployments", "base-8453.json");

function loadTaskRegistryAddress(): string {
  const fromEnv = process.env.TASK_REGISTRY_ADDRESS?.trim();
  if (fromEnv) return fromEnv;

  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(
      "Set TASK_REGISTRY_ADDRESS or add contracts/deployments/base-8453.json with TaskRegistry"
    );
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    TaskRegistry?: string;
  };
  const fromManifest = manifest.TaskRegistry?.trim();
  if (!fromManifest) {
    throw new Error("TaskRegistry missing from base-8453.json — set TASK_REGISTRY_ADDRESS");
  }
  return fromManifest;
}

async function main() {
  const network = await ethers.provider.getNetwork();
  const netName = process.env.HARDHAT_NETWORK ?? network.name;
  const taskRegistry = loadTaskRegistryAddress();

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployer signer — set DEPLOYER_PRIVATE_KEY in contracts/.env");
  }

  console.log("Network:", netName, "chainId:", network.chainId.toString());
  console.log("Deployer:", deployer.address);
  console.log("TaskRegistry:", taskRegistry);

  const factory = await ethers.getContractFactory("TaskScopeRegistry");
  const scopeRegistry = await factory.deploy(taskRegistry);
  await scopeRegistry.waitForDeployment();
  const address = await scopeRegistry.getAddress();

  console.log("\nTaskScopeRegistry:", address);
  console.log("\nAdd to contracts/deployments/base-8453.json:");
  console.log(`  "TaskScopeRegistry": "${address}"`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

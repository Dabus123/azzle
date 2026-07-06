/**
 * Verify TaskScopeRegistry on BaseScan (Etherscan API v2).
 *
 * Requires contracts/.env:
 *   ETHERSCAN_API_KEY=...   (https://etherscan.io/apidashboard)
 *   BASE_RPC_URL=...        (optional; defaults in hardhat config)
 *
 * Usage:
 *   npx hardhat run scripts/verify-task-scope-registry.ts --network base
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";

const MANIFEST_PATH = path.join(__dirname, "..", "deployments", "base-8453.json");

async function main() {
  const apiKey =
    process.env.ETHERSCAN_API_KEY?.trim() || process.env.BASESCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Set ETHERSCAN_API_KEY in contracts/.env (https://etherscan.io/apidashboard)"
    );
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    TaskScopeRegistry?: string;
    TaskRegistry?: string;
  };

  const address = manifest.TaskScopeRegistry?.trim();
  const taskRegistry = process.env.TASK_REGISTRY_ADDRESS?.trim() || manifest.TaskRegistry?.trim();
  if (!address) throw new Error("TaskScopeRegistry missing from base-8453.json");
  if (!taskRegistry) throw new Error("TaskRegistry missing from base-8453.json");

  console.log("Verifying TaskScopeRegistry at", address);
  console.log("Constructor arg TaskRegistry:", taskRegistry);

  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments: [taskRegistry],
    });
    console.log("OK — verified");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log("Already verified");
      return;
    }
    throw e;
  }

  console.log(`\nhttps://basescan.org/address/${address}#code`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

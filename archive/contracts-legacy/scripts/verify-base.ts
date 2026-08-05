/**
 * Verify AZZLE contracts on BaseScan (requires BASESCAN_API_KEY in .env).
 * Get a free key: https://basescan.org/myapikey
 */
import fs from "fs";
import path from "path";
import hre from "hardhat";

const DEPLOY_PATH = path.join(__dirname, "..", "deployments", "base-8453.json");

type DeployManifest = {
  EscrowVault: string;
  TaskRegistry: string;
  ReputationRegistry: string;
  ArbitrationModule: string;
  TreasuryRouter: string;
  AgentDepositVault: string;
  feeRecipient: string;
  usdc: string;
};

async function verify(name: string, address: string, constructorArguments: unknown[] = []) {
  console.log(`\nVerifying ${name} at ${address}...`);
  try {
    await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log(`  OK: ${name}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Already Verified") || msg.includes("already verified")) {
      console.log(`  Already verified: ${name}`);
      return;
    }
    console.error(`  FAILED: ${name}\n`, msg);
    throw e;
  }
}

async function main() {
  const apiKey =
    process.env.ETHERSCAN_API_KEY?.trim() || process.env.BASESCAN_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Set ETHERSCAN_API_KEY in contracts/.env (free: https://etherscan.io/apidashboard — works for Base via API v2)"
    );
  }

  const raw = fs.readFileSync(DEPLOY_PATH, "utf8");
  const d = JSON.parse(raw) as DeployManifest;

  await verify("EscrowVault", d.EscrowVault, []);
  await verify("TaskRegistry", d.TaskRegistry, [d.EscrowVault]);
  await verify("ReputationRegistry", d.ReputationRegistry, []);
  await verify("ArbitrationModule", d.ArbitrationModule, [d.TaskRegistry, d.EscrowVault]);
  await verify("TreasuryRouter", d.TreasuryRouter, [d.TaskRegistry, d.feeRecipient]);
  await verify("AgentDepositVault", d.AgentDepositVault, [d.usdc]);

  console.log("\nAll verifications submitted. Check BaseScan in ~30s:");
  console.log(`  https://basescan.org/address/${d.TaskRegistry}#code`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

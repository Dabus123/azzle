import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(new URL(".", import.meta.url).pathname.replace(/^\/+/, ""), "..");
const manifest = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453.json"), "utf8"));
const siteConfig = await readFile(join(root, "site", "v2-config.js"), "utf8");

const requiredAddresses = [
  manifest.factory,
  manifest.observationOracle,
  manifest.twapAdapter,
  manifest.usdOracle,
  manifest.pricingPolicy,
  manifest.depositVault,
  manifest.escrowVault,
  manifest.reputationRegistry,
  manifest.verifierBondVault,
  manifest.stakingVault,
  manifest.treasuryRouter,
  manifest.taskRegistry,
  manifest.arbitrationModule,
  manifest.paymentGateway,
  manifest.taskScopeRegistry,
  manifest.usdcWethLeg,
  manifest.exactInputExecutor,
  manifest.external.usdc,
  manifest.external.azl,
  manifest.external.weth,
];

const missing = requiredAddresses.filter((address) => !siteConfig.includes(address));
if (missing.length > 0) {
  throw new Error(`V2 site config is missing canonical addresses: ${missing.join(", ")}`);
}

if (!siteConfig.includes(`deploymentBlock: ${manifest.deploymentBlock}`)) {
  throw new Error("V2 site config deploymentBlock does not match the canonical manifest");
}

console.log("V2 site config matches canonical deployment manifest.");

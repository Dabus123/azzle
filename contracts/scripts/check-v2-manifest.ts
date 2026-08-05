import { ethers } from "hardhat";
import manifest from "../deployments/base-8453.json";

const required = [
  "factory",
  "treasuryRouter",
  "observationOracle",
  "twapAdapter",
  "usdOracle",
  "pricingPolicy",
  "depositVault",
  "escrowVault",
  "reputationRegistry",
  "verifierBondVault",
  "stakingVault",
  "taskRegistry",
  "arbitrationModule",
  "paymentGateway",
  "taskScopeRegistry",
] as const;

if (manifest.version !== "2.0.0" || manifest.chainId !== "8453") {
  throw new Error("canonical manifest is not AZZLE V2 on Base");
}

for (const key of required) {
  const address = manifest[key];
  if (!ethers.isAddress(address)) throw new Error(`invalid manifest address: ${key}`);
}

async function main() {
  if (!process.env.BASE_RPC_URL?.trim()) {
    console.log("Skipping live V2 manifest bytecode check: BASE_RPC_URL is not configured.");
    return;
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 8453n) throw new Error(`expected Base, got chain ${network.chainId}`);

  for (const key of required) {
    const address = manifest[key];
    const code = await ethers.provider.getCode(address);
    if (code === "0x") throw new Error(`${key} has no deployed bytecode at ${address}`);
  }

  console.log("V2 canonical manifest bytecode check passed.");
}

void main();

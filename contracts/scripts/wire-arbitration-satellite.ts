/**
 * Deploy and wire ArbitrationSatellite on an existing module + reputation pair.
 *
 * Requires in .env:
 *   ARBITRATION_MODULE_ADDRESS
 *   REPUTATION_REGISTRY_ADDRESS
 * Optional:
 *   ARBITRATION_SATELLITE_ADDRESS (use pre-deployed satellite instead of fresh deploy)
 *
 * Usage:
 *   npm run deploy:wire:satellite -- --network base
 */
import { ethers } from "hardhat";
import { wireArbitrationSatellite } from "./wire-satellite";

async function main() {
  const arbitrationAddress = process.env.ARBITRATION_MODULE_ADDRESS?.trim();
  const reputationAddress = process.env.REPUTATION_REGISTRY_ADDRESS?.trim();
  if (!arbitrationAddress || !reputationAddress) {
    throw new Error("ARBITRATION_MODULE_ADDRESS and REPUTATION_REGISTRY_ADDRESS required");
  }

  const satelliteAddress = await wireArbitrationSatellite(
    arbitrationAddress,
    reputationAddress,
    process.env.ARBITRATION_SATELLITE_ADDRESS?.trim()
  );

  console.log("\nArbitrationSatellite wired:", satelliteAddress);
  console.log("Add to .env: ARBITRATION_SATELLITE_ADDRESS=" + satelliteAddress);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

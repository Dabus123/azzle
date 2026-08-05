import { ethers } from "hardhat";
import { confirm, isZero } from "./deploy-utils";

/**
 * Deploy (if needed) and one-shot wire ArbitrationSatellite on module + reputation.
 * Idempotent when both pointers already match.
 */
export async function wireArbitrationSatellite(
  arbitrationAddress: string,
  reputationAddress: string,
  satelliteAddress?: string
): Promise<string> {
  const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress);
  const reputation = await ethers.getContractAt("ReputationRegistry", reputationAddress);

  const moduleSat = await arbitration.arbitrationSatellite();
  const repSat = await reputation.arbitrationSatellite();
  if (!isZero(moduleSat) && !isZero(repSat)) {
    if (moduleSat.toLowerCase() !== repSat.toLowerCase()) {
      throw new Error(
        `ArbitrationSatellite mismatch: module=${moduleSat} reputation=${repSat}`
      );
    }
    console.log("skip ArbitrationSatellite wiring (already set):", moduleSat);
    return moduleSat;
  }

  let target = satelliteAddress?.trim();
  if (isZero(target)) {
    const satellite = await (
      await ethers.getContractFactory("ArbitrationSatellite")
    ).deploy(arbitrationAddress, reputationAddress);
    await satellite.waitForDeployment();
    target = await satellite.getAddress();
    console.log("ArbitrationSatellite deployed:", target);
  } else {
    const satellite = await ethers.getContractAt("ArbitrationSatellite", target!);
    if ((await satellite.arbitrationModule()).toLowerCase() !== arbitrationAddress.toLowerCase()) {
      throw new Error(
        `Satellite.arbitrationModule is ${await satellite.arbitrationModule()}, expected ${arbitrationAddress}`
      );
    }
    if (
      (await satellite.reputationRegistry()).toLowerCase() !== reputationAddress.toLowerCase()
    ) {
      throw new Error(
        `Satellite.reputationRegistry is ${await satellite.reputationRegistry()}, expected ${reputationAddress}`
      );
    }
  }

  if (isZero(moduleSat)) {
    await confirm(
      "ArbitrationModule.setArbitrationSatellite",
      arbitration.setArbitrationSatellite(target!)
    );
  }
  if (isZero(repSat)) {
    await confirm(
      "ReputationRegistry.setArbitrationSatellite",
      reputation.setArbitrationSatellite(target!)
    );
  }
  return target!;
}

/** Read wired satellite from module; error if unset. */
export async function readArbitrationSatellite(arbitrationAddress: string): Promise<string> {
  const arbitration = await ethers.getContractAt("ArbitrationModule", arbitrationAddress);
  const satellite = await arbitration.arbitrationSatellite();
  if (isZero(satellite)) {
    throw new Error("ArbitrationModule.arbitrationSatellite is unset");
  }
  return satellite;
}

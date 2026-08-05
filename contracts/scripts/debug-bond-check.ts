import hre, { ethers } from "hardhat";

const ADDR = "0x6698C58d1765E533334000B4FBbDC23a04bB453B";

async function main() {
  const factoryAddress = process.env.V2_FACTORY_ADDRESS!.trim();
  const factory = await ethers.getContractAt("AzzleSuiteV2Factory", factoryAddress);
  const panel = (process.env.V2_INITIAL_PANEL || "").split(",").map((v) => v.trim()).filter(Boolean);

  console.log("factory", factoryAddress);
  console.log("deploymentPhase", (await factory.deploymentPhase()).toString());
  console.log("target", ADDR, "code bytes", ((await ethers.provider.getCode(ADDR)).length - 2) / 2);

  const names = [
    "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy", "depositVault",
    "escrowVault", "reputationRegistry", "verifierBondVault", "stakingVault", "treasuryRouter",
    "taskRegistry", "arbitrationModule", "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
  ];
  for (let i = 0; i < 16; i++) {
    const addr = await factory.deployedComponent(i);
    if (addr.toLowerCase() === ADDR.toLowerCase()) console.log(`matches component[${i}] ${names[i]}`);
  }

  const bondVaultAddr = await factory.deployedComponent(7);
  console.log("verifierBondVault", bondVaultAddr);
  if ((await ethers.provider.getCode(bondVaultAddr)) !== "0x") {
    const bondVault = await ethers.getContractAt("VerifierBondVaultV2", bondVaultAddr);
    console.log("minimumBond", (await bondVault.minimumBond()).toString());
    for (const member of panel) {
      const m = ethers.getAddress(member);
      console.log(`panel ${m}`, {
        bonds: (await bondVault.bonds(m)).toString(),
        isEligible: await bondVault.isEligible(m),
        withdrawReadyAt: (await bondVault.withdrawReadyAt(m)).toString(),
      });
    }
  }
}

main().catch(console.error);

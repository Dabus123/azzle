import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(root, "contracts", "deployments", "base-8453.json"), "utf8"));

const current = {
  factory: manifest.factory,
  observationOracle: manifest.observationOracle,
  twapAdapter: manifest.twapAdapter,
  usdOracle: manifest.usdOracle,
  pricingPolicy: manifest.pricingPolicy,
  depositVault: manifest.depositVault,
  escrowVault: manifest.escrowVault,
  reputationRegistry: manifest.reputationRegistry,
  verifierBondVault: manifest.verifierBondVault,
  stakingVault: manifest.stakingVault,
  treasuryRouter: manifest.treasuryRouter,
  taskRegistry: manifest.taskRegistry,
  arbitrationModule: manifest.arbitrationModule,
  paymentGateway: manifest.paymentGateway,
  taskScopeRegistry: manifest.taskScopeRegistry,
  usdcWethLeg: manifest.usdcWethLeg,
  exactInputExecutor: manifest.exactInputExecutor,
  usdc: manifest.external.usdc,
  azl: manifest.external.azl,
  weth: manifest.external.weth,
};

const contractCards = [
  ["AZL Token", manifest.external.azl],
  ["TaskRegistryV2", manifest.taskRegistry],
  ["EscrowVaultV2", manifest.escrowVault],
  ["AgentDepositVaultV2", manifest.depositVault],
  ["ReputationRegistryV2", manifest.reputationRegistry],
  ["ArbitrationModuleV2", manifest.arbitrationModule],
  ["VerifierBondVaultV2", manifest.verifierBondVault],
  ["UnionStakingVaultV2", manifest.stakingVault],
  ["TreasuryRouterV2", manifest.treasuryRouter],
  ["TaskScopeRegistryV2", manifest.taskScopeRegistry],
  ["AzlUsdOracle", manifest.usdOracle],
  ["AzlPricingPolicy", manifest.pricingPolicy],
  ["AzlPaymentGateway", manifest.paymentGateway],
  ["AzzleSuiteV2Factory", manifest.factory],
].map(([label, address]) => (
  `    <a class="ct" href="https://basescan.org/address/${address}" title="${label} — ${address}" target="_blank" rel="noopener noreferrer"><div class="cdot"></div><div class="cname">${label}</div><div class="caddr">${address}</div></a>`
)).join("\n");

// Addresses from the superseded V2 browser/API surface. This is intentionally
// a one-way migration map; the manifest above remains the only active source.
const stale = {
  factory: "0x941caBB483349eB64Cfddb165DcbFe08340f5513",
  observationOracle: "0xf62a42573201Dbb12D65bE64d2fC49a148878906",
  twapAdapter: "0x3bd92dA93F77348EC86D0A4e0fE168E6D1d3D509",
  usdOracle: "0x7106997DAeeaF943963F6E433cA9917ae05Fe402",
  pricingPolicy: "0x8Fd288FC43Dd8c65c04a54e5886e09A234caE979",
  depositVault: "0xc8250fA88967A0dAD939E617675bf6a4b3d85A9B",
  escrowVault: "0x3bA91E0b16f47d8b12b9c4BC6324eCDeaCC5EaC7",
  reputationRegistry: "0x7AD232D7458Ff4937dd7239286F12E89E211870f",
  verifierBondVault: "0x66336a0f45Ed06A37D898aBe75F97Ff3e1A74E47",
  stakingVault: "0xE5C3324eE10a9F27A35D213bAac7c13F391B56C7",
  treasuryRouter: "0x9b97507E12A0c394d9072e6aa0F3020b72cC055E",
  taskRegistry: "0xBe42E77a1555c6456ff79F530B9101c6459C032e",
  arbitrationModule: "0xCc25F5068528d09673f2a1E5F48aE64638e4D550",
  paymentGateway: "0x22bB1B6f9DCe35653487843d5DC202267dc036E6",
  taskScopeRegistry: "0x6f0989607083d52Bf92E22dd08A524f336e6e17d",
  usdcWethLeg: "0x3051d3009427a9E2728Af2E1fd9B872cCCf1af27",
  exactInputExecutor: "0x7B14e50DA366aa396dB9E7CCc0C40a39458e14F0",
};

const files = [
  join(root, "site", "docs", "contracts.html"),
  join(root, "site", "docs", "api.html"),
  join(root, "site", "index.html"),
];

for (const file of files) {
  let content = await readFile(file, "utf8");
  for (const key of Object.keys(stale)) {
    content = content.split(stale[key]).join(current[key]);
  }
  // These contracts are not present in the canonical V2 manifest. Do not
  // leave stale legacy/V2 hybrid rows in the active contract reference.
  if (file.endsWith(join("site", "docs", "contracts.html"))) {
    content = content.replace(
      /\s*<tr>\s*<td><strong>ArbitrationSatellite<\/strong>[\s\S]*?<\/tr>\s*/i,
      "\n"
    );
    content = content.replace(
      /\s*<tr>\s*<td><strong>ArbitrationRecoveryCoordinator<\/strong>[\s\S]*?<\/tr>\s*/i,
      "\n"
    );
  }
  if (file.endsWith(join("site", "index.html"))) {
    content = content.replace(
      /([ \t]*<!-- CANONICAL-CONTRACT-CARDS:START -->)[\s\S]*?([ \t]*<!-- CANONICAL-CONTRACT-CARDS:END -->)/,
      `\n$1\n${contractCards}\n$2`
    );
  }
  await writeFile(file, content);
}

console.log("[site-addresses] synchronized active site surfaces from canonical V2 manifest");

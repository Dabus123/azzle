import path from "path";
import { config as loadEnv } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

loadEnv({ path: path.resolve(__dirname, ".env") });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const mainnetRpc = process.env.MAINNET_RPC_URL?.trim();
const baseRpc = process.env.BASE_RPC_URL?.trim();
const etherscanKey =
  process.env.BASESCAN_API_KEY?.trim() || process.env.ETHERSCAN_API_KEY?.trim();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Favor deployability: TaskRegistry is feature-dense and must remain below EIP-170.
      optimizer: { enabled: true, runs: 0 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./src/v2",
    tests: "./src/v2/test-canonical",
  },
  networks: {
    hardhat: { chainId: 8453 },
    ...(mainnetRpc
      ? {
          mainnet: {
            url: mainnetRpc,
            accounts: deployerKey ? [deployerKey] : [],
            chainId: 1,
          },
        }
      : {}),
    ...(baseRpc
      ? {
          base: {
            url: baseRpc,
            accounts: deployerKey ? [deployerKey] : [],
            chainId: 8453,
          },
        }
      : {}),
  },
  // Single Etherscan.io key -> API v2 (chainid=8453 for Base). Per-network keys use deprecated v1.
  etherscan: etherscanKey ? { apiKey: etherscanKey } : undefined,
  sourcify: { enabled: false },
};

if (!baseRpc && process.argv.includes("--network") && process.argv.includes("base")) {
  throw new Error(
    "Base network is unavailable: set BASE_RPC_URL in contracts/.env before running deployment or promotion commands."
  );
}

export default config;

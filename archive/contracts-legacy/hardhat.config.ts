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
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
  },
  networks: {
    hardhat: {},
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
  // Single Etherscan.io key → API v2 (chainid=8453 for Base). Per-network keys use deprecated v1.
  etherscan: etherscanKey ? { apiKey: etherscanKey } : undefined,
  sourcify: { enabled: false },
};

export default config;

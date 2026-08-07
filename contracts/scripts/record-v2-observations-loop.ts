import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { Contract, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";

const INTERVAL_MS = 14 * 60 * 1000;
const CONTRACTS_ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.resolve(CONTRACTS_ROOT, "deployments", "base-8453.json");
const OBSERVER_ABI = [
  "function record()",
  "function observationCount() view returns (uint256)",
  "function epochStartIndex() view returns (uint256)",
  "function latestObservation() view returns (uint64 timestamp, int24 tick, int56 tickCumulative)",
] as const;

let stopping = false;
let nextTimer: NodeJS.Timeout | undefined;

async function runRecord(): Promise<void> {
  loadEnv({ path: path.resolve(CONTRACTS_ROOT, ".env"), override: true, quiet: true });
  const rpcUrl = process.env.BASE_RPC_URL?.trim();
  const privateKey = (process.env.KEEPER_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY)?.trim();
  if (!rpcUrl || !privateKey) throw new Error("BASE_RPC_URL and KEEPER_PRIVATE_KEY are required");
  if (!fs.existsSync(MANIFEST_PATH)) throw new Error(`V2 deployment manifest not found: ${MANIFEST_PATH}`);

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8")) as {
    chainId?: string;
    observationOracle?: string;
  };
  if (manifest.chainId !== "8453" || !manifest.observationOracle || !isAddress(manifest.observationOracle)) {
    throw new Error("V2 deployment manifest has no valid Base observationOracle address");
  }

  const provider = new JsonRpcProvider(rpcUrl, 8453, { staticNetwork: true });
  const wallet = new Wallet(privateKey, provider);
  const observer = new Contract(getAddress(manifest.observationOracle), OBSERVER_ABI, wallet);
  const tx = await observer.record();
  console.log(`Submitted observation record: ${tx.hash}`);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("observation record transaction failed");
  const [count, epochStart, latest] = await Promise.all([
    observer.observationCount(),
    observer.epochStartIndex(),
    observer.latestObservation(),
  ]);
  console.log(JSON.stringify({
    observer: await observer.getAddress(),
    recorder: wallet.address,
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    observationCount: count.toString(),
    epochStartIndex: epochStart.toString(),
    latestObservation: {
      timestamp: latest.timestamp.toString(),
      tick: latest.tick.toString(),
      tickCumulative: latest.tickCumulative.toString(),
    },
  }, null, 2));
}

async function checkpoint(): Promise<void> {
  if (stopping) return;
  try {
    await runRecord();
  } catch (error) {
    console.error("Observation checkpoint failed; retrying in 14 minutes.", error);
  }
  if (!stopping) nextTimer = setTimeout(() => void checkpoint(), INTERVAL_MS);
}

function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  if (nextTimer) clearTimeout(nextTimer);
  console.log(`Received ${signal}; observer checkpoint loop stopped.`);
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

console.log("Starting V2 observer checkpoint loop: one record() now, then every 14 minutes.");
void checkpoint();

import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

type V2Candidate = {
  chainId: string;
  observationOracle: string;
};

const CANDIDATE_PATH = path.resolve(__dirname, "../deployments/base-8453-v2.candidate.json");
const OBSERVER_ABI = [
  "function record()",
  "function observationCount() view returns (uint256)",
  "function epochStartIndex() view returns (uint256)",
  "function latestObservation() view returns (uint64 timestamp, int24 tick, int56 tickCumulative)",
] as const;

async function main() {
  const current = await ethers.provider.getNetwork();
  if (current.chainId !== 8453n || network.name !== "base") {
    throw new Error("V2 observation recording is Base mainnet only");
  }
  if (!fs.existsSync(CANDIDATE_PATH)) {
    throw new Error(`V2 candidate receipt not found: ${CANDIDATE_PATH}`);
  }

  const candidate = JSON.parse(fs.readFileSync(CANDIDATE_PATH, "utf8")) as V2Candidate;
  if (candidate.chainId !== "8453" || !ethers.isAddress(candidate.observationOracle)) {
    throw new Error("V2 candidate receipt has no valid Base observationOracle address");
  }
  const observerAddress = ethers.getAddress(candidate.observationOracle);
  if ((await ethers.provider.getCode(observerAddress)) === "0x") {
    throw new Error(`V2 observation oracle has no code: ${observerAddress}`);
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer signer configured");
  const observer = new ethers.Contract(observerAddress, OBSERVER_ABI, deployer);

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
    observer: observerAddress,
    recorder: deployer.address,
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

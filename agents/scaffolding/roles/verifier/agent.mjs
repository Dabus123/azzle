import { ethers } from "ethers";
import { buildExecutionReceipt } from "@azzle/agents";
import manifest from "./base-8453.json" with { type: "json" };
import {
  DEFAULT_BOND_WEI,
  monitorBondSlashRisk,
  stakeVerifierBond,
  unstakeVerifierBond,
} from "./lib/bonds.mjs";
import { printMarketSnapshot } from "./lib/indexer.mjs";
import { attestationMetadata, evaluateReceipt } from "./lib/validation.mjs";

const rpcUrl = process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org";

function requireSigner() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) throw new Error("Set PRIVATE_KEY in .env");
  return new ethers.Wallet(pk, new ethers.JsonRpcProvider(rpcUrl));
}

async function runPreflight() {
  const signer = requireSigner();
  const wallet = await signer.getAddress();
  const { bond, warnings } = await monitorBondSlashRisk(signer.provider, wallet);
  console.log("[verifier] bond (ETH)", ethers.formatEther(bond));
  for (const w of warnings) console.warn("[verifier] WARNING:", w);
  await printMarketSnapshot();
}

async function stakeFlow() {
  const signer = requireSigner();
  const bond = process.env.BOND_WEI ? BigInt(process.env.BOND_WEI) : DEFAULT_BOND_WEI;
  await stakeVerifierBond(signer, bond);
}

async function unstakeFlow() {
  const signer = requireSigner();
  const amount = process.env.UNSTAKE_WEI ? BigInt(process.env.UNSTAKE_WEI) : DEFAULT_BOND_WEI / 2n;
  await unstakeVerifierBond(signer, amount);
}

async function validationLoop() {
  const expectedHash = process.env.EXPECTED_OUTPUT_HASH ?? "0x" + "ab".repeat(32);
  const receipt = buildExecutionReceipt({
    taskId: process.env.TASK_ID ?? "1",
    milestoneIndex: 0,
    worker: "0x0000000000000000000000000000000000000002",
    artifacts: [{ type: "deterministic_output", hash: expectedHash, uri: "ipfs://stub" }],
  });

  const result = await evaluateReceipt(receipt, { mode: "deterministic" }, expectedHash);
  const meta = attestationMetadata(result);
  console.log("[verifier] attestation stub", { result, meta });
  console.log("[verifier] wire attestation on-chain when quorum_met — see VERIFIER_SPEC.md");
}

async function main() {
  const cmd = process.argv[2] ?? "help";

  if (cmd === "preflight") {
    await runPreflight();
    return;
  }
  if (cmd === "stake") {
    await stakeFlow();
    return;
  }
  if (cmd === "unstake") {
    await unstakeFlow();
    return;
  }
  if (cmd === "validate") {
    await validationLoop();
    return;
  }

  console.log(`AZZLE verifier agent (Base ${manifest.chainId})`);
  console.log("");
  console.log("Commands:");
  console.log("  npm run preflight   # bond + slash-risk + subgraph snapshot");
  console.log("  npm run stake       # ReputationRegistry.stakeVerifierBond");
  console.log("  node agent.mjs unstake");
  console.log("  npm run validate    # receipt validation loop stub");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

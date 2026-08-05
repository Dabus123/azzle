import { ethers } from "ethers";
import type { TaskTerms } from "./types.js";

/** Canonical V2 offchain settlement digest bound to immutable task terms. */
export function buildSettlementDigest(terms: TaskTerms): string {
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "uint256",
      "address",
      "address",
      "address",
      "uint256",
      "bytes32",
    ],
    [
      ethers.id("azzle-task-settlement-v3-azl"),
      terms.chainId,
      terms.registryAddress,
      terms.poster,
      terms.worker,
      terms.totalAmount,
      terms.acceptanceCriteriaHash,
    ]
  );
  return ethers.keccak256(encoded);
}

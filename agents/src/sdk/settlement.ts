import { ethers } from "ethers";
import type { TaskTerms } from "./types.js";

const ESCROW_MODE_MAP: Record<string, number> = {
  upfront: 0,
  milestone: 1,
  streaming: 2,
  hour_blocks: 3,
};

/** Canonical settlement digest per protocol/XMTP_EVM_BRIDGE.md */
export function buildSettlementDigest(terms: TaskTerms): string {
  const milestoneAmounts = terms.milestoneAmounts ?? [];
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "bytes32",
      "address",
      "address",
      "address",
      "uint256",
      "uint8",
      "uint256[]",
      "uint256",
      "bytes32",
      "bool",
      "uint16",
    ],
    [
      ethers.id("azzle-task-v1"),
      terms.poster,
      terms.worker,
      terms.token,
      terms.totalAmount,
      ESCROW_MODE_MAP[terms.escrowMode] ?? 1,
      milestoneAmounts,
      terms.deadline,
      terms.acceptanceCriteriaHash,
      terms.replacementAllowed,
      terms.feeBps ?? 100,
    ]
  );
  return ethers.keccak256(encoded);
}

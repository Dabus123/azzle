/**
 * Reference verifier — deterministic hash comparison.
 */
import type { ExecutionReceipt } from "../sdk/types.js";

export interface AcceptanceCriteria {
  mode: "deterministic" | "semi-deterministic" | "subjective";
  specHash?: string;
}

export function verifyDeterministic(
  receipt: ExecutionReceipt,
  expectedOutputHash: string
): { valid: boolean; confidence: number } {
  const output = receipt.artifacts.find((a) => a.type === "deterministic_output");
  if (!output) return { valid: false, confidence: 0 };
  const valid = output.hash.toLowerCase() === expectedOutputHash.toLowerCase();
  return { valid, confidence: valid ? 1 : 0 };
}

export async function runVerifierAgent(
  receipt: ExecutionReceipt,
  criteria: AcceptanceCriteria,
  expectedOutputHash: string
) {
  if (criteria.mode === "deterministic") {
    const result = verifyDeterministic(receipt, expectedOutputHash);
    console.log("[verifier-agent] attestation", result);
    return result;
  }
  throw new Error(`Verifier mode ${criteria.mode} not implemented in reference agent`);
}

import { ethers } from "ethers";
import type { ExecutionReceipt } from "./types.js";

export function canonicalizeReceipt(receipt: Omit<ExecutionReceipt, "receiptHash">): string {
  const sorted = JSON.stringify(receipt, Object.keys(receipt).sort());
  return sorted;
}

export function hashReceipt(receipt: Omit<ExecutionReceipt, "receiptHash">): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeReceipt(receipt)));
}

export function buildExecutionReceipt(params: {
  taskId: string;
  milestoneIndex: number;
  worker: string;
  artifacts: ExecutionReceipt["artifacts"];
}): ExecutionReceipt {
  const base = {
    schemaVersion: "azzle-receipt-v1" as const,
    taskId: params.taskId,
    milestoneIndex: params.milestoneIndex,
    worker: params.worker,
    completedAt: new Date().toISOString(),
    artifacts: params.artifacts,
  };
  const receiptHash = hashReceipt(base);
  return { ...base, receiptHash };
}

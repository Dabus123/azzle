/**
 * Reference worker agent — executes task, builds execution receipt, submits proof.
 */
import { buildExecutionReceipt } from "../sdk/receipt.js";

export async function runWorkerAgent(params: {
  taskId: string;
  worker: string;
  deliverableHash: string;
}) {
  const receipt = buildExecutionReceipt({
    taskId: params.taskId,
    milestoneIndex: 0,
    worker: params.worker,
    artifacts: [
      {
        type: "deterministic_output",
        hash: params.deliverableHash,
        uri: "ipfs://placeholder",
      },
    ],
  });

  console.log("[worker-agent] delivery ready", {
    receiptHash: receipt.receiptHash,
    artifactCount: receipt.artifacts.length,
  });

  return receipt;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWorkerAgent({
    taskId: "1",
    worker: "0x0000000000000000000000000000000000000002",
    deliverableHash: "0x" + "ab".repeat(32),
  }).catch(console.error);
}

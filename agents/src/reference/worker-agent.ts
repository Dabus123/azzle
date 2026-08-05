/**
 * Reference worker agent — Base RPC discovery, demo execution, and live XMTP worker.
 */
import { buildExecutionReceipt } from "../sdk/receipt.js";
import { RpcDiscovery } from "../sdk/rpc-discovery.js";

export { startLiveWorker, LiveWorkerService } from "./live-worker.js";
export type { LiveWorkerConfig, LiveWorkerRuntime } from "./live-worker.js";
export {
  checkWorkerPreflight,
  logPreflightReport,
  ensureAzlAllowance,
} from "../sdk/preflight.js";
export { BASE_MAINNET_MANIFEST } from "../sdk/manifest.js";
export { createXmtpClient } from "../sdk/xmtp/signer.js";
export { resolveXmtpClientOptions } from "../sdk/xmtp/client-config.js";

/** List claimable tasks directly from the Base TaskRegistry. */
export async function listOpenTasks(rpcUrl?: string) {
  return new RpcDiscovery({ rpcUrl }).getOpenTasks();
}

export async function runWorkerAgent(params: {
  taskId: string;
  worker: string;
  deliverableHash: string;
}) {
  const receipt = buildExecutionReceipt({
    taskId: params.taskId,
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

const isDirectRun =
  typeof process.argv[1] === "string" &&
  (process.argv[1].endsWith("worker-agent.js") ||
    process.argv[1].endsWith("worker-agent.ts"));

if (isDirectRun) {
  const cmd = process.argv[2];
  if (cmd === "list-open") {
    listOpenTasks(process.env.BASE_RPC_URL)
      .then((tasks) => {
        console.log("[worker-agent] open tasks", tasks.length);
        for (const t of tasks) {
          console.log({ id: t.id, poster: t.poster.id, escrowAmount: t.escrowAmount });
        }
      })
      .catch(console.error);
  } else {
    runWorkerAgent({
      taskId: "1",
      worker: "0x0000000000000000000000000000000000000002",
      deliverableHash: "0x" + "ab".repeat(32),
    }).catch(console.error);
  }
}

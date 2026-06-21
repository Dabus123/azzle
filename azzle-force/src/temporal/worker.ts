import { Worker, NativeConnection } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnvConfig } from "../config.js";
import * as activities from "./activities.js";

const __dir = dirname(fileURLToPath(import.meta.url));

export async function runTemporalWorker(): Promise<void> {
  const config = loadEnvConfig();
  const connection = await NativeConnection.connect({ address: config.temporalAddress });

  const worker = await Worker.create({
    connection,
    namespace: config.temporalNamespace,
    taskQueue: config.temporalTaskQueue,
    workflowsPath: resolve(__dir, "workflows.js"),
    activities,
  });

  console.log(`[temporal] worker listening on ${config.temporalTaskQueue}`);
  await worker.run();
}

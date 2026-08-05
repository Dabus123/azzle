import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcDiscovery } from "@azzle/agents";

const __dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dir, "base-8453.json"), "utf8"));

const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org" });
const tasks = await indexer.getOpenTasks();

console.log(
  JSON.stringify(
    {
      network: manifest.network,
      chainId: manifest.chainId,
      taskRegistry: manifest.taskRegistry,
      count: tasks.length,
      tasks,
    },
    null,
    2
  )
);

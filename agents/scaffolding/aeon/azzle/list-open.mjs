import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SubgraphIndexer } from "@azzle/agents";

const __dir = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dir, "base-8453.json"), "utf8"));

const subgraphUrl = process.env.AZZLE_SUBGRAPH_URL;
const indexer = new SubgraphIndexer({ subgraphUrl });
const tasks = await indexer.getOpenTasks();

console.log(
  JSON.stringify(
    {
      network: manifest.network,
      chainId: manifest.chainId,
      taskRegistry: manifest.TaskRegistry,
      count: tasks.length,
      tasks,
    },
    null,
    2
  )
);

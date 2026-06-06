import { SubgraphIndexer } from "@azzle/agents";
import manifest from "./base-8453.json" with { type: "json" };

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

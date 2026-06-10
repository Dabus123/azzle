import { SubgraphIndexer } from "@azzle/agents";

export async function fetchOpenTasks() {
  const indexer = new SubgraphIndexer({ subgraphUrl: process.env.AZZLE_SUBGRAPH_URL });
  return indexer.getOpenTasks();
}

export async function fetchAgentSignals(address) {
  const indexer = new SubgraphIndexer({ subgraphUrl: process.env.AZZLE_SUBGRAPH_URL });
  return indexer.getAgentReputation(address);
}

export async function printMarketSnapshot() {
  const tasks = await fetchOpenTasks();
  console.log("[indexer] open tasks", tasks.length);
  for (const t of tasks.slice(0, 10)) {
    console.log({
      id: t.id,
      poster: t.poster?.id,
      escrowAmount: t.escrowAmount,
      state: t.state,
    });
  }
  return tasks;
}

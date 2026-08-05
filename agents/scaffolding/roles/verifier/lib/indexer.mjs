import { RpcDiscovery } from "@azzle/agents";

export async function fetchOpenTasks() {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org" });
  return indexer.getOpenTasks();
}

export async function fetchAgentSignals(address) {
  const indexer = new RpcDiscovery({ rpcUrl: process.env.AZZLE_RPC_URL ?? "https://mainnet.base.org" });
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

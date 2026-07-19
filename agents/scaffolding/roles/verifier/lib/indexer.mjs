import { BaseRpcIndexer } from "@azzle/agents";

export async function fetchOpenTasks() {
  const indexer = new BaseRpcIndexer({ rpcUrl: process.env.AZZLE_RPC_URL });
  return indexer.getOpenTasks();
}

export async function fetchAgentSignals(address) {
  void address;
  throw new Error("Use the paid azzle-reputation x402 Cloud endpoint for reputation history.");
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

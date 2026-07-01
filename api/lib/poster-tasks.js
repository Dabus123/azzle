/** Poster task list via AZZLE subgraph (kept under api/ for Vercel bundling). */
import { subgraphGql } from "./subgraph.js";

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

export async function getPosterTasks(address) {
  const id = normAddr(address);
  if (!id) throw new Error("Wallet address required");

  const data = await subgraphGql(
    `query PosterTasks($id: ID!) {
      agent(id: $id) {
        id
        postedTasks(first: 100, orderBy: createdAt, orderDirection: desc) {
          id
          state
          escrowAmount
          createdAt
          updatedAt
          settlementDigest
          worker { id }
        }
      }
    }`,
    { id }
  );

  const tasks = data?.agent?.postedTasks ?? [];
  return tasks.map((t) => ({
    id: t.id,
    state: t.state,
    escrowAmount: t.escrowAmount,
    budgetUsdc: Number(t.escrowAmount) / 1e6,
    createdAt: Number(t.createdAt),
    updatedAt: Number(t.updatedAt),
    worker: t.worker?.id ?? null,
    settlementDigest: t.settlementDigest ?? null,
  }));
}

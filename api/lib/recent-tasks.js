/** Recent tasks across all states (market history). */
import { subgraphGql } from "./subgraph.js";

function mapTasks(rows) {
  return (rows ?? []).map((t) => ({
    id: t.id,
    state: t.state,
    escrowAmount: t.escrowAmount,
    budgetUsdc: Number(t.escrowAmount) / 1e6,
    createdAt: Number(t.createdAt),
    updatedAt: Number(t.updatedAt ?? t.createdAt),
    poster: t.poster?.id ?? t.poster ?? null,
    worker: t.worker?.id ?? t.worker ?? null,
  }));
}

export async function getRecentTasks(limit = 50) {
  const first = Math.min(Math.max(Number(limit) || 50, 1), 100);

  const data = await subgraphGql(
    `query RecentTasks($first: Int!) {
      tasks(
        first: $first
        orderBy: createdAt
        orderDirection: desc
      ) {
        id
        state
        escrowAmount
        createdAt
        updatedAt
        poster { id }
        worker { id }
      }
    }`,
    { first }
  );
  return mapTasks(data?.tasks);
}

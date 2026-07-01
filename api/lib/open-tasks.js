/** POSTED (claimable) tasks via AZZLE subgraph (onchain fallback on 429). */
import { SubgraphError, subgraphGql } from "./subgraph.js";
import { getOpenTasksOnchain } from "./open-tasks-onchain.js";

function mapTasks(rows) {
  return (rows ?? []).map((t) => ({
    id: t.id,
    state: t.state,
    escrowAmount: t.escrowAmount,
    budgetUsdc: Number(t.escrowAmount) / 1e6,
    createdAt: Number(t.createdAt),
    updatedAt: Number(t.updatedAt ?? t.createdAt),
    poster: t.poster?.id ?? t.poster ?? null,
  }));
}

export async function getOpenTasks(limit = 100) {
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);

  try {
    const data = await subgraphGql(
      `query OpenTasks($first: Int!) {
        tasks(
          where: { state: "POSTED" }
          orderBy: createdAt
          orderDirection: desc
          first: $first
        ) {
          id
          state
          escrowAmount
          createdAt
          updatedAt
          poster { id }
        }
      }`,
      { first }
    );
    return mapTasks(data?.tasks);
  } catch (err) {
    if (err instanceof SubgraphError && err.status === 429) {
      return getOpenTasksOnchain(first);
    }
    throw err;
  }
}

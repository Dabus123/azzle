/** POSTED (claimable) tasks via AZZLE subgraph. */
const SUBGRAPH_URL =
  process.env.AZZLE_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

async function gql(query, variables) {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }
  return json.data;
}

export async function getOpenTasks(limit = 100) {
  const first = Math.min(Math.max(Number(limit) || 100, 1), 100);
  const data = await gql(
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

  return (data?.tasks ?? []).map((t) => ({
    id: t.id,
    state: t.state,
    escrowAmount: t.escrowAmount,
    budgetUsdc: Number(t.escrowAmount) / 1e6,
    createdAt: Number(t.createdAt),
    updatedAt: Number(t.updatedAt),
    poster: t.poster?.id ?? null,
  }));
}

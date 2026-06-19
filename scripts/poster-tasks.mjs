/**
 * Poster task list via AZZLE subgraph.
 */
const SUBGRAPH_URL =
  process.env.AZZLE_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

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

export async function getPosterTasks(address) {
  const id = normAddr(address);
  if (!id) throw new Error("Wallet address required");

  const data = await gql(
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

import { sendJson } from "../lib/respond.js";

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

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const host = req.headers?.host || "azzle.org";
    const url = new URL(req.url || "/api/poster/tasks", `https://${host}`);
    const address = url.searchParams.get("address");
    const id = normAddr(address);
    if (!id) {
      sendJson(res, 400, { error: "Wallet address required" });
      return;
    }

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

    const tasks = (data?.agent?.postedTasks ?? []).map((t) => ({
      id: t.id,
      state: t.state,
      escrowAmount: t.escrowAmount,
      budgetUsdc: Number(t.escrowAmount) / 1e6,
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt),
      worker: t.worker?.id ?? null,
      settlementDigest: t.settlementDigest ?? null,
    }));

    sendJson(res, 200, { tasks });
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

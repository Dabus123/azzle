/**
 * x402 Cloud service: azzle-leaderboard
 * Paid leaderboard — top AZZLE agents by reputation, or top verifiers by
 * staked ETH bond. One service, two views via the `kind` param.
 *
 * Self-contained handler (per-service bundle): no cross-directory imports.
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

const SUBGRAPH =
  process.env.AZZLE_SUBGRAPH_URL ||
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(SUBGRAPH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AZZLE subgraph HTTP ${res.status}`);
  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
  if (!json.data) throw new Error("AZZLE subgraph: empty response");
  return json.data;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Agent {
  id: string;
  reputationScore: string;
  tasksCompleted: number;
  disputesWon: number;
  disputesLost: number;
  verifierBondEth: string;
}

export default async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const kind = (params.get("kind") ?? "reputation").toLowerCase();
  const raw = Number(params.get("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;

  if (kind !== "reputation" && kind !== "verifiers") {
    return json({ error: "invalid_kind", hint: "kind=reputation|verifiers" }, 400);
  }

  const orderBy = kind === "verifiers" ? "verifierBondEth" : "reputationScore";
  const filter = kind === "verifiers" ? "verifierBondEth_gt" : "reputationScore_gt";

  const data = await gql<{ agents: Agent[] }>(
    `query Leaderboard($first: Int!) {
       agents(first: $first, orderBy: ${orderBy}, orderDirection: desc, where: { ${filter}: "0" }) {
         id reputationScore tasksCompleted disputesWon disputesLost verifierBondEth
       }
     }`,
    { first: limit }
  );

  return {
    protocol: "azzle",
    chainId: 8453,
    kind,
    count: data.agents.length,
    agents: data.agents.map((a) => ({
      address: a.id,
      reputationScore: a.reputationScore,
      tasksCompleted: a.tasksCompleted,
      disputesWon: a.disputesWon,
      disputesLost: a.disputesLost,
      verifierBondEth: a.verifierBondEth,
    })),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

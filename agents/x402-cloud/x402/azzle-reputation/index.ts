/**
 * x402 Cloud service: azzle-reputation
 * Paid reputation lookup — aggregated on-chain rep, task/dispute history,
 * verifier bond, and recent reputation signals for one AZZLE agent.
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
  signals: Array<{
    id: string;
    signalType: string;
    weight: string;
    emittedAt: string;
    taskId: string;
  }>;
}

export default async function handler(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_address", hint: "pass ?address=0x... (40 hex chars)" }, 400);
  }

  const data = await gql<{ agent: Agent | null }>(
    `query AgentReputation($id: ID!) {
       agent(id: $id) {
         id reputationScore tasksCompleted disputesWon disputesLost verifierBondEth
         signals(orderBy: emittedAt, orderDirection: desc, first: 100) {
           id signalType weight emittedAt taskId
         }
       }
     }`,
    { id: address.toLowerCase() }
  );

  if (!data.agent) {
    return {
      protocol: "azzle",
      chainId: 8453,
      address: address.toLowerCase(),
      found: false,
      reputationScore: "0",
      tasksCompleted: 0,
      disputesWon: 0,
      disputesLost: 0,
      verifierBondEth: "0",
      signals: [],
    };
  }

  const a = data.agent;
  return {
    protocol: "azzle",
    chainId: 8453,
    address: a.id,
    found: true,
    reputationScore: a.reputationScore,
    tasksCompleted: a.tasksCompleted,
    disputesWon: a.disputesWon,
    disputesLost: a.disputesLost,
    verifierBondEth: a.verifierBondEth,
    signals: a.signals ?? [],
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

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

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const REPUTATION_REGISTRY = "0x462dCB4903583D99889f4aD42C4c5008A519082a";
const SIGNAL_TOPIC = "0x8dec6f04e0839835cb16a21f69e6cace4c71f3f7f5d7905c66119082f7dc8606";
const BOND_STAKED_TOPIC = "0x1e5421cab6612afbc21f23d3668b52ef07307857c5170034c03f5240fe84977a";
const BOND_UNSTAKED_TOPIC = "0x12749114f90df4a48a970b7f233b00d88715cf052ee9780c9683a9e4f6e56796";
const BOND_SLASHED_TOPIC = "0x7ffc6dd47451c70566ca177d5b8d9f38781039f9c49c90afb3213ac6dbf93e70";
const SIGNALS_SELECTOR = "0x47c740cd";
const BOND_SELECTOR = "0xc13c5e2a";
const START_BLOCK = process.env.AZZLE_REPUTATION_START_BLOCK || "0x0";

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Base RPC empty response");
  return body.result;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function topicAddress(topic: string) {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function word(data: string, index: number) {
  return BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
}

async function contractUint(selector: string, address: string) {
  const data = `${selector}${address.slice(2).padStart(64, "0")}`;
  return BigInt(await rpc("eth_call", [{ to: REPUTATION_REGISTRY, data }, "latest"]) as string);
}

async function logs(topic: string) {
  return rpc("eth_getLogs", [{
    address: REPUTATION_REGISTRY, fromBlock: START_BLOCK, toBlock: "latest", topics: [topic],
  }]) as Promise<Array<{ topics: string[]; data: string }>>;
}

export default async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const kind = (params.get("kind") ?? "reputation").toLowerCase();
  const raw = Number(params.get("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;

  if (kind !== "reputation" && kind !== "verifiers") {
    return json({ error: "invalid_kind", hint: "kind=reputation|verifiers" }, 400);
  }

  const participants = new Set<string>();
  let agents: Array<{
    address: string; reputationScore: string; tasksCompleted: number;
    disputesWon: number; disputesLost: number; verifierBondEth: string; sort: bigint;
  }> = [];

  if (kind === "reputation") {
    const signalLogs = await logs(SIGNAL_TOPIC);
    const scores = new Map<string, { score: bigint; completed: number; won: number; lost: number }>();
    for (const log of signalLogs) {
      const address = topicAddress(log.topics[2]);
      const signalType = Number(word(log.data, 0));
      const signalId = BigInt(log.topics[1]);
      const signalData = await rpc("eth_call", [{
        to: REPUTATION_REGISTRY, data: `${SIGNALS_SELECTOR}${signalId.toString(16).padStart(64, "0")}`,
      }, "latest"]) as string;
      const row = scores.get(address) || { score: 0n, completed: 0, won: 0, lost: 0 };
      row.score += word(signalData, 3);
      if (signalType === 0) row.completed += 1;
      if (signalType === 2) row.won += 1;
      if (signalType === 3) row.lost += 1;
      scores.set(address, row);
    }
    agents = [...scores.entries()].map(([address, row]) => ({
      address, reputationScore: row.score.toString(), tasksCompleted: row.completed,
      disputesWon: row.won, disputesLost: row.lost, verifierBondEth: "0", sort: row.score,
    }));
  } else {
    const eventLogs = await Promise.all([logs(BOND_STAKED_TOPIC), logs(BOND_UNSTAKED_TOPIC), logs(BOND_SLASHED_TOPIC)]);
    eventLogs.flat().forEach((log) => participants.add(topicAddress(log.topics[1])));
    const bonds = await Promise.all([...participants].map(async (address) => [address, await contractUint(BOND_SELECTOR, address)] as const));
    agents = bonds.filter(([, bond]) => bond > 0n).map(([address, bond]) => ({
      address, reputationScore: "0", tasksCompleted: 0, disputesWon: 0, disputesLost: 0,
      verifierBondEth: (bond / 1_000_000_000_000_000_000n).toString(), sort: bond,
    }));
  }
  agents.sort((a, b) => (a.sort === b.sort ? 0 : a.sort > b.sort ? -1 : 1));
  const rows = agents.slice(0, limit).map(({ sort, ...agent }) => agent);

  return {
    protocol: "azzle",
    chainId: 8453,
    kind,
    count: rows.length,
    agents: rows,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

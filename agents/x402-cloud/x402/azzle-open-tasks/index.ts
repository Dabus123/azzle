/**
 * x402 Cloud service: azzle-open-tasks
 * Paid task discovery — AZZLE tasks in POSTED state (claimable search market).
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

function usdc(amount6: string): string {
  try {
    const n = BigInt(amount6);
    const whole = n / 1_000_000n;
    const frac = (n % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
    return `${whole}.${frac}`;
  } catch {
    return "0.00";
  }
}

interface Task {
  id: string;
  state: string;
  escrowAmount: string;
  createdAt: string;
  updatedAt: string;
  settlementDigest: string | null;
  poster: { id: string };
  worker: { id: string } | null;
}

export default async function handler(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;

  // Throwing → non-2xx, so the caller is NOT charged (settle-after-response).
  const data = await gql<{ tasks: Task[] }>(
    `query OpenTasks($first: Int!) {
       tasks(first: $first, where: { state: "POSTED" }, orderBy: createdAt, orderDirection: desc) {
         id state escrowAmount createdAt updatedAt settlementDigest
         poster { id } worker { id }
       }
     }`,
    { first: limit }
  );

  return {
    protocol: "azzle",
    chainId: 8453,
    network: "base",
    count: data.tasks.length,
    tasks: data.tasks.map((t) => ({
      id: t.id,
      state: t.state,
      poster: t.poster.id,
      worker: t.worker?.id ?? null,
      escrowUsdc: usdc(t.escrowAmount),
      escrowAmount: t.escrowAmount,
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt),
      settlementDigest: t.settlementDigest,
    })),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

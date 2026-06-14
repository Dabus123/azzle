/**
 * x402 Cloud service: azzle-task
 * Paid single-task inspection — full AZZLE task row by on-chain id.
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
    return `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
  } catch {
    return "0.00";
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_id", hint: "pass ?id=<numeric task id>" }, 400);
  }

  const data = await gql<{ task: Task | null }>(
    `query TaskById($id: ID!) {
       task(id: $id) {
         id state escrowAmount createdAt updatedAt settlementDigest
         poster { id } worker { id }
       }
     }`,
    { id }
  );

  if (!data.task) {
    return json({ protocol: "azzle", chainId: 8453, id, found: false }, 404);
  }

  const t = data.task;
  return {
    protocol: "azzle",
    chainId: 8453,
    found: true,
    task: {
      id: t.id,
      state: t.state,
      poster: t.poster.id,
      worker: t.worker?.id ?? null,
      escrowUsdc: usdc(t.escrowAmount),
      escrowAmount: t.escrowAmount,
      createdAt: Number(t.createdAt),
      updatedAt: Number(t.updatedAt),
      settlementDigest: t.settlementDigest,
    },
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

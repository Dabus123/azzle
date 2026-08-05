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

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const params = new URL(req.url).searchParams;
  const kind = (params.get("kind") ?? "reputation").toLowerCase();
  const raw = Number(params.get("limit") ?? "25");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 25;

  if (kind !== "reputation" && kind !== "verifiers") {
    return json({ error: "invalid_kind", hint: "kind=reputation|verifiers" }, 400);
  }

  return json(
    {
      error: "not_implemented",
      hint: "RPC cannot enumerate all reputation subjects without an event index. Use azzle-reputation for a known address.",
      kind,
      limit,
    },
    501
  );
}

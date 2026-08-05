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

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const REPUTATION = "0xa35Ca46926DD319fD47cA1b2b77835EDb7404de";
const ARBITRATOR_REPUTATION = "0xcb1f3217";
const VERIFIER_BOND = "0xc13c5e2a";
const SUBJECT_SIGNAL_COUNT = "0x04a68640";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || json.result === undefined) throw new Error(json.error?.message ?? "Base RPC empty response");
  return json.result;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function addressArg(address: string): string {
  return address.toLowerCase().slice(2).padStart(64, "0");
}

export default async function handler(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_address", hint: "pass ?address=0x... (40 hex chars)" }, 400);
  }

  const arg = addressArg(address);
  const [reputationScore, verifierBondEth, signalCount] = await Promise.all([
    rpc<string>("eth_call", [{ to: REPUTATION, data: `${ARBITRATOR_REPUTATION}${arg}` }, "latest"]),
    rpc<string>("eth_call", [{ to: REPUTATION, data: `${VERIFIER_BOND}${arg}` }, "latest"]),
    rpc<string>("eth_call", [{ to: REPUTATION, data: `${SUBJECT_SIGNAL_COUNT}${arg}` }, "latest"]),
  ]);
  return {
    protocol: "azzle",
    chainId: 8453,
    address: address.toLowerCase(),
    found: true,
    reputationScore: BigInt(reputationScore).toString(),
    verifierBondEth: BigInt(verifierBondEth).toString(),
    signalCount: BigInt(signalCount).toString(),
    signals: [],
    note: "On-chain aggregate values; event history is intentionally not indexed by this RPC endpoint.",
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

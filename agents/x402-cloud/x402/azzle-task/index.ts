/**
 * x402 Cloud service: azzle-task
 * Paid single-task inspection — full AZZLE task row by on-chain id.
 *
 * Self-contained handler (per-service bundle): no cross-directory imports.
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TASK_REGISTRY = "0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48";
const GET_TASK_SELECTOR = "0x1d65e77e";
const STATES = ["DRAFT", "POSTED", "CLAIMED", "ACTIVE", "IN_REVIEW", "COMPLETED", "CANCELLED", "EXPIRED", "DISPUTED", "RESOLVED", "REPLACING", "PAUSED", "DELETED"];

async function rpc(data: string) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: TASK_REGISTRY, data }, "latest"] }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Base RPC empty response");
  return body.result;
}

function word(data: string, index: number) {
  return BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
}

function address(data: string, index: number) {
  return `0x${word(data, index).toString(16).padStart(40, "0")}`;
}

function usdc(amount: bigint): string {
  return `${amount / 1_000_000n}.${(amount % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_id", hint: "pass ?id=<numeric task id>" }, 400);
  }

  const data = await rpc(`${GET_TASK_SELECTOR}${BigInt(id).toString(16).padStart(64, "0")}`);
  const createdAt = word(data, 8);
  const poster = address(data, 0);
  if (!createdAt || poster === "0x0000000000000000000000000000000000000000") {
    return json({ protocol: "azzle", chainId: 8453, id, found: false }, 404);
  }

  const amount = word(data, 3);
  const worker = address(data, 1);
  return {
    protocol: "azzle",
    chainId: 8453,
    found: true,
    task: {
      id,
      state: STATES[Number(word(data, 6))] || "UNKNOWN",
      poster,
      worker: worker === "0x0000000000000000000000000000000000000000" ? null : worker,
      escrowUsdc: usdc(amount),
      escrowAmount: amount.toString(),
      createdAt: Number(createdAt),
      updatedAt: Number(createdAt),
      settlementDigest: `0x${data.slice(2 + 5 * 64, 2 + 6 * 64)}`,
    },
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

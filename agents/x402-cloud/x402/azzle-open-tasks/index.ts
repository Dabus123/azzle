/**
 * x402 Cloud service: azzle-open-tasks
 * Paid task discovery — AZZLE tasks in POSTED state (claimable search market).
 *
 * Self-contained handler (per-service bundle): no cross-directory imports.
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TASK_REGISTRY = "0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48";
const TASK_COUNT_SELECTOR = "0xb6cb58a5";
const GET_TASK_SELECTOR = "0x1d65e77e";
const POSTED = 1;
const SCAN_WINDOW = 400;

async function rpc(method: string, params: unknown[]) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
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

async function getTask(id: bigint) {
  const data = await rpc("eth_call", [{ to: TASK_REGISTRY, data: `${GET_TASK_SELECTOR}${id.toString(16).padStart(64, "0")}` }, "latest"]);
  const state = Number(word(data, 6));
  if (state !== POSTED) return null;
  const amount = word(data, 3);
  return {
    id: id.toString(), state: "POSTED", poster: address(data, 0), worker: null,
    escrowUsdc: usdc(amount), escrowAmount: amount.toString(),
    createdAt: Number(word(data, 8)), updatedAt: Number(word(data, 8)),
    settlementDigest: `0x${data.slice(2 + 5 * 64, 2 + 6 * 64)}`,
  };
}

export default async function handler(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;

  // Throwing → non-2xx, so the caller is NOT charged (settle-after-response).
  const count = Number(BigInt(await rpc("eth_call", [{ to: TASK_REGISTRY, data: TASK_COUNT_SELECTOR }, "latest"])));
  const tasks = [];
  for (let id = BigInt(count); id >= BigInt(Math.max(1, count - SCAN_WINDOW + 1)) && tasks.length < limit; id -= 1n) {
    const task = await getTask(id);
    if (task) tasks.push(task);
  }

  return {
    protocol: "azzle",
    chainId: 8453,
    network: "base",
    count: tasks.length,
    tasks,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

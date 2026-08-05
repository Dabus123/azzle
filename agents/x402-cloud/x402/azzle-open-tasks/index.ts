/**
 * x402 Cloud service: azzle-open-tasks
 * Paid task discovery — AZZLE tasks in POSTED state (claimable search market).
 *
 * Price + schema live in ../../bankr.x402.json.
 *
 * @see docs/X402_CLOUD.md
 */

import { BASE_MAINNET_MANIFEST } from "../manifest";

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const TASK_REGISTRY = BASE_MAINNET_MANIFEST.taskRegistry;
const TASK_COUNT = "0xb6cb58a5";
const GET_TASK = "0x1d65e77e";
const POSTED = 1n;
const SCAN_WINDOW = 5_000;
const ZERO = "0x0000000000000000000000000000000000000000";

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

function callData(selector: string, id?: bigint): string {
  return id === undefined ? selector : `${selector}${id.toString(16).padStart(64, "0")}`;
}

function word(data: string, index: number): string {
  return data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function parseTask(id: bigint, data: string) {
  const totalAmount = BigInt(`0x${word(data, 2)}`);
  const funded = BigInt(`0x${word(data, 3)}`);
  const released = BigInt(`0x${word(data, 4)}`);
  const state = BigInt(`0x${word(data, 8)}`);
  if (state !== POSTED) return null;
  const worker = `0x${word(data, 1).slice(24)}`;
  return {
    protocolVersion: "v2",
    asset: "AZL",
    id: `v2:${id.toString()}`,
    localTaskId: id.toString(),
    state: "POSTED",
    poster: `0x${word(data, 0).slice(24)}`,
    worker: worker.toLowerCase() === ZERO ? null : worker,
    totalAmountAzlWei: totalAmount.toString(),
    fundedAzlWei: funded.toString(),
    releasedAzlWei: released.toString(),
    deadline: Number(BigInt(`0x${word(data, 5)}`)),
    fundingDeadline: Number(BigInt(`0x${word(data, 6)}`)),
    deliveredAt: Number(BigInt(`0x${word(data, 7)}`)),
  };
}

export default async function handler(req: Request) {
  const raw = Number(new URL(req.url).searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 50;

  // Throwing → non-2xx, so the caller is NOT charged (settle-after-response).
  const count = Number(BigInt(await rpc<string>("eth_call", [{ to: TASK_REGISTRY, data: TASK_COUNT }, "latest"])));
  const tasks: ReturnType<typeof parseTask>[] = [];
  for (let id = count; id >= Math.max(1, count - SCAN_WINDOW + 1) && tasks.length < limit; id--) {
    const task = parseTask(BigInt(id), await rpc<string>("eth_call", [{ to: TASK_REGISTRY, data: callData(GET_TASK, BigInt(id)) }, "latest"]));
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

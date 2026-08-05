/**
 * x402 Cloud service: azzle-task-scope
 * Paid public-scope lookup for a V2 task.
 *
 * Private tasks intentionally return `published: false`; x402 payment does not
 * grant access to XMTP/private scope.
 */

import { BASE_MAINNET_MANIFEST } from "../manifest";

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const SCOPE_REGISTRY = BASE_MAINNET_MANIFEST.taskScopeRegistry;
const SCOPE_OF = "0x3cb5ef1b";

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error || json.result === undefined) {
    throw new Error(json.error?.message ?? "Base RPC empty response");
  }
  return json.result;
}

function word(data: string, index: number): string {
  return data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function decodeString(data: string): string {
  const offset = Number(BigInt(`0x${word(data, 0)}`));
  const length = Number(BigInt(`0x${word(data, offset / 32)}`));
  const start = 2 + (offset + 32) * 2;
  const bytes = data.slice(start, start + length * 2);
  return new TextDecoder().decode(
    Uint8Array.from(bytes.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^\d+$/.test(id) || BigInt(id) === 0n) {
    return json({ error: "invalid_id", hint: "pass ?id=<numeric task id>" }, 400);
  }

  let data: string;
  try {
    data = await rpc<string>("eth_call", [{
      to: SCOPE_REGISTRY,
      data: `${SCOPE_OF}${BigInt(id).toString(16).padStart(64, "0")}`,
    }, "latest"]);
  } catch {
    return json({ protocol: "azzle", chainId: 8453, taskId: id, published: false }, 404);
  }

  try {
    const scope = decodeString(data);
    if (!scope) {
      return { protocol: "azzle", chainId: 8453, taskId: id, published: false, scope: null };
    }
    return {
      protocol: "azzle",
      chainId: 8453,
      taskId: id,
      published: true,
      scope,
      generatedAt: Math.floor(Date.now() / 1000),
    };
  } catch {
    return json({ protocol: "azzle", chainId: 8453, taskId: id, published: false }, 404);
  }
}

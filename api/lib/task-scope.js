/** Read onchain task scope from TaskScopeRegistry (Base). */
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const RPC_URL = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";

const SCOPE_ABI = [
  {
    type: "function",
    name: "scopeOf",
    stateMutability: "view",
    inputs: [{ name: "taskId", type: "uint256" }],
    outputs: [{ type: "string" }],
  },
];

export function taskScopeRegistryAddress() {
  const fromEnv = process.env.NEXT_TASK_SCOPE_ADDRESS?.trim();
  if (fromEnv) return fromEnv;
  return MANIFEST.taskScopeRegistry?.trim() || null;
}

export async function readOnchainTaskScope(taskId) {
  const registry = taskScopeRegistryAddress();
  if (!registry) return null;

  try {
    const client = createPublicClient({ chain: base, transport: http(RPC_URL) });
    const scope = await client.readContract({
      address: registry,
      abi: SCOPE_ABI,
      functionName: "scopeOf",
      args: [BigInt(taskId)],
    });
    const text = String(scope ?? "").trim();
    return text || null;
  } catch {
    return null;
  }
}

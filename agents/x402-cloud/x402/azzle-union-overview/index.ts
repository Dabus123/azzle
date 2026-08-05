/**
 * x402 Cloud service: azzle-union-overview
 * Paid, agent-readable Union Staking and Action Credits launch state.
 */
import { BASE_MAINNET_MANIFEST } from "../manifest";

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const VAULT = BASE_MAINNET_MANIFEST.stakingVault;
const SELECTORS = {
  stakingActive: "0xa6ac4b35",
  totalStaked: "0x817b1cd2",
  totalCreditsIssued: "0x2008d7a0",
  totalCreditsSpent: "0xe67e0d45",
  creditsRemaining: "0x9379bde3",
  creditIssuanceClosed: "0x0d22a470",
};

async function call(data: string): Promise<string> {
  const response = await fetch(RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: VAULT, data }, "latest"] }),
  });
  if (!response.ok) throw new Error(`Base RPC HTTP ${response.status}`);
  const json = await response.json() as { result?: string; error?: { message: string } };
  if (!json.result) throw new Error(json.error?.message || "Base RPC empty response");
  return json.result;
}

export default async function handler() {
  const [active, staked, issued, spent, remaining, closed] = await Promise.all(
    Object.values(SELECTORS).map(call)
  );
  return {
    protocol: "azzle", chainId: 8453, vault: VAULT, generatedAt: Math.floor(Date.now() / 1000),
    stakingActive: BigInt(active) !== 0n,
    totalStakedAzl: BigInt(staked).toString(),
    totalCreditsIssued: BigInt(issued).toString(),
    totalCreditsSpent: BigInt(spent).toString(),
    creditsRemaining: BigInt(remaining).toString(),
    creditIssuanceClosed: BigInt(closed) !== 0n,
  };
}

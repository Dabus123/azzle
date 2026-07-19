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
const REPUTATION_REGISTRY = "0x462dCB4903583D99889f4aD42C4c5008A519082a";
const SIGNAL_COUNT_SELECTOR = "0x04a68640";
const SIGNALS_SELECTOR = "0x47c740cd";
const SUBJECT_SIGNALS_SELECTOR = "0x2effeef9";
const BOND_SELECTOR = "0xc13c5e2a";
const ARBITRATOR_REPUTATION_SELECTOR = "0xcb1f3217";
const SIGNAL_NAMES = [
  "TASK_COMPLETED", "TASK_FAILED", "DISPUTE_WON", "DISPUTE_LOST", "PROOF_REJECTED",
  "REPLACEMENT_PENALTY", "VERIFIER_ATTESTATION", "PEER_ENDORSEMENT",
  "ARBITRATOR_STANDBY", "ARBITRATOR_RESOLVED",
];

async function call(data: string) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: REPUTATION_REGISTRY, data }, "latest"] }),
  });
  if (!res.ok) throw new Error(`Base RPC HTTP ${res.status}`);
  const body = (await res.json()) as { result?: string; error?: { message?: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Base RPC empty response");
  return body.result;
}

function word(data: string, index: number) {
  return BigInt(`0x${data.slice(2 + index * 64, 2 + (index + 1) * 64)}`);
}

function addressWord(address: string) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request) {
  const address = new URL(req.url).searchParams.get("address");
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    // 400 → non-2xx, caller not charged.
    return json({ error: "invalid_address", hint: "pass ?address=0x... (40 hex chars)" }, 400);
  }

  const encodedAddress = addressWord(address);
  const [countData, bondData, reputationData] = await Promise.all([
    call(`${SIGNAL_COUNT_SELECTOR}${encodedAddress}`),
    call(`${BOND_SELECTOR}${encodedAddress}`),
    call(`${ARBITRATOR_REPUTATION_SELECTOR}${encodedAddress}`),
  ]);
  const signalCount = Number(BigInt(countData));
  const signals = [];
  let tasksCompleted = 0;
  let disputesWon = 0;
  let disputesLost = 0;
  let reputationScore = BigInt(reputationData);
  for (let index = Math.max(0, signalCount - 100); index < signalCount; index += 1) {
    const signalIdData = await call(`${SUBJECT_SIGNALS_SELECTOR}${encodedAddress}${index.toString(16).padStart(64, "0")}`);
    const signalData = await call(`${SIGNALS_SELECTOR}${BigInt(signalIdData).toString(16).padStart(64, "0")}`);
    const signalType = Number(word(signalData, 1));
    const weight = word(signalData, 3);
    if (signalType === 0) tasksCompleted += 1;
    if (signalType === 2) disputesWon += 1;
    if (signalType === 3) disputesLost += 1;
    reputationScore += weight;
    signals.push({
      id: BigInt(signalIdData).toString(), signalType: SIGNAL_NAMES[signalType] || "UNKNOWN",
      weight: weight.toString(), emittedAt: Number(word(signalData, 4)), taskId: word(signalData, 2).toString(),
    });
  }

  return {
    protocol: "azzle",
    chainId: 8453,
    address: address.toLowerCase(),
    found: signalCount > 0 || BigInt(bondData) > 0n || BigInt(reputationData) > 0n,
    reputationScore: reputationScore.toString(),
    tasksCompleted,
    disputesWon,
    disputesLost,
    verifierBondEth: (BigInt(bondData) / 1_000_000_000_000_000_000n).toString(),
    signals: signals.reverse(),
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

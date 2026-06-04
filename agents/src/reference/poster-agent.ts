/**
 * Reference poster agent — funds escrow, monitors delivery, accepts milestones.
 * XMTP: wire @xmtp/node-sdk in production; uses NegotiationBus for local demo.
 */
import { NegotiationBus } from "../sdk/xmtp-stub.js";
import { buildSettlementDigest } from "../sdk/settlement.js";
import type { TaskTerms } from "../sdk/types.js";

export async function runPosterAgent(terms: TaskTerms) {
  const bus = new NegotiationBus();
  const negotiationId = bus.createNegotiation();

  const digest = buildSettlementDigest(terms);

  bus.post(negotiationId, {
    type: "azzle/TaskProposal",
    task: { schemaVersion: "azzle-task-v1", title: "Reference task" },
    settlementDigestPreview: digest,
  });

  bus.post(negotiationId, {
    type: "azzle/TaskAcceptance",
    settlementDigest: digest,
    posterSignature: "0x",
    workerSignature: "0x",
  });

  console.log("[poster-agent] negotiation complete", { negotiationId, digest });
  return { negotiationId, digest };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPosterAgent({
    poster: "0x0000000000000000000000000000000000000001",
    worker: "0x0000000000000000000000000000000000000002",
    token: "0x0000000000000000000000000000000000000003",
    totalAmount: 1000000n,
    escrowMode: "milestone",
    milestoneAmounts: [1000000n],
    deadline: Math.floor(Date.now() / 1000) + 86400,
    acceptanceCriteriaHash: "0x" + "00".repeat(32),
    replacementAllowed: true,
  }).catch(console.error);
}

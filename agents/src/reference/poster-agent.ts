/**
 * Reference poster agent — funds escrow, monitors delivery, accepts milestones.
 * Uses NegotiationBus locally; use startAgent() from ../sdk/xmtp for production XMTP.
 */
import { NegotiationBus } from "../sdk/xmtp-local-bus.js";
import { buildSettlementDigest } from "../sdk/settlement.js";
import { buildEnvelope } from "../sdk/xmtp/envelope.js";
import type { TaskTerms } from "../sdk/types.js";

export async function runPosterAgent(terms: TaskTerms) {
  const bus = new NegotiationBus();
  const negotiationId = bus.createNegotiation();
  const digest = buildSettlementDigest(terms);

  await bus.send(
    buildEnvelope({
      type: "TaskProposal",
      negotiationId,
      sequence: 1,
      sender: {
        evmAddress: terms.poster.toLowerCase(),
        xmtpPublicKey: "0x" + "01".repeat(32),
      },
      payload: {
        type: "azzle/TaskProposal",
        task: {
          schemaVersion: "azzle-task-v1",
          taskType: "software.implementation",
          title: "Reference task",
          acceptanceCriteria: {
            mode: "deterministic",
            specHash: terms.acceptanceCriteriaHash,
          },
          compensation: {
            token: terms.token,
            amount: terms.totalAmount.toString(),
            escrowMode: terms.escrowMode,
          },
        },
        settlementDigestPreview: digest,
      },
    })
  );

  await bus.send(
    buildEnvelope({
      type: "TaskAcceptance",
      negotiationId,
      sequence: 2,
      sender: {
        evmAddress: terms.poster.toLowerCase(),
        xmtpPublicKey: "0x" + "01".repeat(32),
      },
      payload: {
        type: "azzle/TaskAcceptance",
        settlementDigest: digest,
        posterSignature: "0x",
        workerSignature: "0x",
      },
    })
  );

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

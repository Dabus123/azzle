import { randomUUID } from "node:crypto";
import { buildSettlementDigest } from "../dist/sdk/settlement.js";
import { buildEnvelope } from "../dist/sdk/xmtp/envelope.js";
import { buildSettlementTypedData } from "../dist/sdk/xmtp/settlement-verify.js";
import { parseTaskTerms, serializeTerms } from "./terms-utils.mjs";

const CHAIN_ID = 8453n;

export function buildTaskTermsBundle(from, flags, manifest, options = {}) {
  const fail = (msg) => {
    throw new Error(msg);
  };
  const parsed = parseTaskTerms(from, flags, manifest, { ...options, fail });
  return {
    ok: true,
    action: "build-task-terms",
    chainId: Number(CHAIN_ID),
    terms: serializeTerms(parsed.terms),
    settlementDigest: parsed.digest,
    streamRate: parsed.streamRate.toString(),
    hourBlockSize: parsed.hourBlockSize.toString(),
    warnings: parsed.warnings,
  };
}

export function verifySettlementDigest(from, flags, manifest, options = {}) {
  const bundle = buildTaskTermsBundle(from, flags, manifest, options);
  const expected = flags.digest ?? flags.settlement_digest;
  if (!expected) {
    throw new Error("--digest required to verify");
  }
  const match = bundle.settlementDigest.toLowerCase() === expected.toLowerCase();
  return {
    ok: true,
    action: "verify-settlement-digest",
    match,
    computed: bundle.settlementDigest,
    expected,
    terms: bundle.terms,
  };
}

export function buildXmtpProposal(from, flags, manifest, options = {}) {
  const bundle = buildTaskTermsBundle(from, flags, manifest, options);
  const negotiationId = flags.negotiation_id ?? randomUUID();
  const taskSummary = {
    title: flags.title ?? "AZZLE task",
    description: flags.description ?? "",
    acceptanceCriteriaHash: bundle.terms.acceptanceCriteriaHash,
    totalAmountUsdc6: bundle.terms.totalAmount,
    escrowMode: bundle.terms.escrowMode,
    deadline: bundle.terms.deadline,
  };

  const envelope = buildEnvelope({
    type: "TaskProposal",
    negotiationId,
    sequence: Number(flags.sequence ?? "1"),
    previousHash: flags.previous_hash,
    sender: {
      evmAddress: from.toLowerCase(),
      xmtpPublicKey: flags.xmtp_public_key ?? "0x" + "00".repeat(32),
    },
    payload: {
      type: "azzle/TaskProposal",
      task: taskSummary,
      settlementDigestPreview: bundle.settlementDigest,
      terms: bundle.terms,
    },
  });

  return {
    ok: true,
    action: "build-xmtp-proposal",
    negotiationId,
    settlementDigest: bundle.settlementDigest,
    terms: bundle.terms,
    envelope,
    warnings: bundle.warnings,
    nextSteps: [
      "Counterparty reviews terms and settlementDigestPreview",
      "Both parties sign TaskAcceptance typed data (see build-xmtp-acceptance-template)",
      "Poster runs create-task or post-task with matching terms, then fund-task",
    ],
  };
}

export function buildXmtpAcceptanceTemplate(from, flags, manifest, options = {}) {
  const bundle = buildTaskTermsBundle(from, flags, manifest, options);
  const typed = buildSettlementTypedData({
    settlementDigest: bundle.settlementDigest,
    poster: bundle.terms.poster,
    worker: bundle.terms.worker,
    chainId: CHAIN_ID,
  });

  return {
    ok: true,
    action: "build-xmtp-acceptance-template",
    settlementDigest: bundle.settlementDigest,
    terms: bundle.terms,
    typedData: typed,
    envelopeTemplate: {
      type: "TaskAcceptance",
      negotiationId: flags.negotiation_id ?? "<negotiation-uuid>",
      payload: {
        type: "azzle/TaskAcceptance",
        settlementDigest: bundle.settlementDigest,
        posterSignature: "<from Base MCP sign typed data>",
        workerSignature: "<from Base MCP sign typed data>",
        terms: bundle.terms,
      },
    },
    signFlow: [
      "Poster: Base MCP sign typed data with typedData below (poster wallet)",
      "Worker: Base MCP sign typed data with same typedData (worker wallet)",
      "Exchange signatures over XMTP TaskAcceptance or proceed to on-chain create/post",
    ],
  };
}

/** Recompute digest from serialized terms object. */
export function digestFromSerializedTerms(terms) {
  return buildSettlementDigest({
    poster: terms.poster,
    worker: terms.worker,
    token: terms.token,
    totalAmount: BigInt(terms.totalAmount),
    escrowMode: terms.escrowMode,
    milestoneAmounts: terms.milestoneAmounts.map((m) => BigInt(m)),
    streamRate: BigInt(terms.streamRate ?? 0),
    hourBlockSize: BigInt(terms.hourBlockSize ?? 0),
    deadline: Number(terms.deadline),
    acceptanceCriteriaHash: terms.acceptanceCriteriaHash,
    chainId: BigInt(terms.chainId ?? 8453),
    registryAddress: terms.registryAddress,
  });
}

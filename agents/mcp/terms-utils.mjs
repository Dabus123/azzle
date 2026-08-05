import { ethers } from "ethers";
import { buildSettlementDigest } from "../dist/sdk/settlement.js";

export const ESCROW_MODE = { milestone: 1, streaming: 2, hour_blocks: 3 };

export function resolveCriteriaHash(flags, fail) {
  if (flags.criteria_text) {
    return ethers.id(flags.criteria_text);
  }
  const hash = flags.acceptance_criteria_hash;
  if (!hash) {
    fail("--acceptance-criteria-hash or --criteria-text required");
  }
  return hash;
}

export function parseMilestoneAmounts(flags, totalAmount, fail) {
  if (flags.milestone_amounts) {
    const parts = flags.milestone_amounts.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) fail("--milestone-amounts must be comma-separated USDC (6dp) values");
    return parts.map((p) => BigInt(p));
  }
  return [totalAmount];
}

export function parseStreamParams(flags, escrowMode) {
  return {
    streamRate: BigInt(flags.stream_rate ?? "0"),
    hourBlockSize: BigInt(flags.hour_block_size ?? "0"),
  };
}

export function parseTaskTerms(from, flags, manifest, { requireWorker = false, fail }) {
  const totalAmount = BigInt(flags.total_amount ?? fail("--total-amount required (USDC 6dp)"));
  const deadline = Number(flags.deadline ?? fail("--deadline required (unix seconds)"));
  const acceptanceCriteriaHash = resolveCriteriaHash(flags, fail);
  const escrowMode = flags.escrow_mode ?? "milestone";
  if (!(escrowMode in ESCROW_MODE)) {
    fail("--escrow-mode must be milestone, streaming, or hour_blocks");
  }
  const milestoneAmounts = parseMilestoneAmounts(flags, totalAmount, fail);
  const { streamRate, hourBlockSize } = parseStreamParams(flags, escrowMode);

  const milestoneSum = milestoneAmounts.reduce((a, b) => a + b, 0n);
  const warnings = [];
  if (milestoneSum !== totalAmount) {
    warnings.push(
      `milestone sum ${milestoneSum} != total-amount ${totalAmount} — verify before posting`
    );
  }
  if (escrowMode === "streaming" && streamRate === 0n) {
    warnings.push("escrow-mode streaming but --stream-rate is 0");
  }
  if (escrowMode === "hour_blocks" && hourBlockSize === 0n) {
    warnings.push("escrow-mode hour_blocks but --hour-block-size is 0");
  }

  let worker = ethers.ZeroAddress;
  if (requireWorker) {
    const raw = flags.worker ?? fail("--worker required (0x address, not zero)");
    if (!ethers.isAddress(raw) || raw === ethers.ZeroAddress) {
      fail("--worker must be a non-zero EVM address");
    }
    worker = ethers.getAddress(raw);
  }

  const terms = {
    poster: from,
    worker,
    token: manifest.external.usdc,
    totalAmount,
    escrowMode,
    milestoneAmounts,
    streamRate,
    hourBlockSize,
    deadline,
    acceptanceCriteriaHash,
    chainId: BigInt(flags.chain_id ?? "8453"),
    registryAddress: manifest.taskRegistry,
  };

  const digest = buildSettlementDigest(terms);

  return {
    terms,
    digest,
    streamRate,
    hourBlockSize,
    warnings,
  };
}

export function serializeTerms(terms) {
  return {
    poster: terms.poster,
    worker: terms.worker,
    token: terms.token,
    totalAmount: terms.totalAmount.toString(),
    escrowMode: terms.escrowMode,
    milestoneAmounts: terms.milestoneAmounts.map((m) => m.toString()),
    deadline: terms.deadline,
    acceptanceCriteriaHash: terms.acceptanceCriteriaHash,
    streamRate: terms.streamRate.toString(),
    hourBlockSize: terms.hourBlockSize.toString(),
    chainId: terms.chainId.toString(),
    registryAddress: terms.registryAddress,
  };
}

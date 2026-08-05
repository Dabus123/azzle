/** Map MCP tool args → prepare/xmtp CLI flags. */
export function termFlagsFromMcpArgs(args = {}) {
  const flags = {};
  if (args.poster) flags.from = String(args.poster);
  if (args.from) flags.from = String(args.from);
  if (args.worker) flags.worker = String(args.worker);
  if (args.totalAmount != null) flags.total_amount = String(args.totalAmount);
  if (args.deadline != null) flags.deadline = String(args.deadline);
  if (args.criteriaText) flags.criteria_text = String(args.criteriaText);
  if (args.acceptanceCriteriaHash) {
    flags.acceptance_criteria_hash = String(args.acceptanceCriteriaHash);
  }
  if (args.escrowMode) flags.escrow_mode = String(args.escrowMode);
  if (args.milestoneAmounts) flags.milestone_amounts = String(args.milestoneAmounts);
  if (args.streamRate != null) flags.stream_rate = String(args.streamRate);
  if (args.hourBlockSize != null) flags.hour_block_size = String(args.hourBlockSize);
  if (args.title) flags.title = String(args.title);
  if (args.description) flags.description = String(args.description);
  if (args.negotiationId) flags.negotiation_id = String(args.negotiationId);
  if (args.digest) flags.digest = String(args.digest);
  if (args.settlementDigest) flags.digest = String(args.settlementDigest);
  return flags;
}

export const TERM_TOOL_PROPERTIES = {
  poster: { type: "string", description: "Poster EVM address (0x…)" },
  worker: { type: "string", description: "Worker EVM address (0x…) for direct hire" },
  totalAmount: { type: "string", description: "Total USDC amount, 6 decimals (e.g. 100000000)" },
  deadline: { type: "number", description: "Unix timestamp deadline" },
  criteriaText: { type: "string", description: "Acceptance criteria text (hashed to bytes32)" },
  acceptanceCriteriaHash: { type: "string", description: "Precomputed bytes32 criteria hash" },
  escrowMode: {
    type: "string",
    description: "milestone | streaming | hour_blocks (default milestone)",
  },
  milestoneAmounts: {
    type: "string",
    description: "Comma-separated USDC 6dp milestone amounts (must sum to totalAmount)",
  },
  streamRate: { type: "string", description: "USDC 6dp per second (streaming mode)" },
  hourBlockSize: { type: "string", description: "USDC 6dp per hour block (hour_blocks mode)" },
};

/** Tier gates — arbitration/ESCALATION.md */
export const TIER_GATES = {
  0: { label: "Tier 0 (< $1)", minRep: 0, minResolved: 0, needsDeposit: true },
  1: { label: "Tier 1 ($1–$99)", minRep: 50, minResolved: 0, needsDeposit: true },
  2: { label: "Tier 2 (≥ $100)", minRep: 200, minResolved: 5, needsDeposit: true },
};

export function tierForAmountUsdc6(amount) {
  const n = Number(amount);
  if (n < 1_000_000) return 0;
  if (n < 100_000_000) return 1;
  return 2;
}

export function checkTierEligibility(tier, { rep, resolvedCount, hasDeposit }) {
  const gate = TIER_GATES[tier];
  if (!gate) return { eligible: false, reasons: [`Unknown tier ${tier}`] };
  const reasons = [];
  if (gate.needsDeposit && !hasDeposit) reasons.push("Requires ≥ $20 USDC AgentDepositVault deposit");
  if (rep < gate.minRep) reasons.push(`arbitratorReputation ${rep} < ${gate.minRep}`);
  if (resolvedCount < gate.minResolved) {
    reasons.push(`resolvedCount ${resolvedCount} < ${gate.minResolved}`);
  }
  return { eligible: reasons.length === 0, reasons, gate };
}

export function workerBpsSplit(workerSharePercent) {
  const bps = Math.round(workerSharePercent * 100);
  if (bps < 0 || bps > 10_000) throw new Error("workerBps must be 0–10000");
  return bps;
}

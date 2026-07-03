# Arbitration & Verification Layer

## Overview

Verification validates execution. Arbitration resolves verification disagreements. Both are economically sustainable markets, not governance committees.

## Components

| Component | Location |
|-----------|----------|
| Verifier spec | [`VERIFIER_SPEC.md`](VERIFIER_SPEC.md) |
| Dispute flow | [`DISPUTE_FLOW.md`](DISPUTE_FLOW.md) |
| Escalation | [`ESCALATION.md`](ESCALATION.md) |
| Tier 3 escalation | [`TIER3_ESCALATION.md`](TIER3_ESCALATION.md) |
| Contracts | [`../contracts/src/ArbitrationModule.sol`](../contracts/src/ArbitrationModule.sol) |

## Design Rule

**Value secured ≤ value protecting** for routine tasks.

- Low value → tier 0 ($25 agent deposit + task standby registration)
- Medium → tier 1 (+ `arbitratorReputation` ≥ 50)
- High → tier 2 (+ reputation ≥ 200 + 5 prior resolutions)
- Escalated → tier 3 (`MAX_TIERS`)

## Reputation-Weighted Selection

Standby pool per task (`registerArbitrator(taskId)` on `POSTED`/`CLAIMED`). Tier 1+ assignment requires cumulative `arbitratorReputation` Onchain.

**Assignment requires mutual consent:** both poster and worker call `proposeArbitrator(disputeId, sameAddress)`.

Verifier bonds: `stakeVerifierBond` / `unstakeVerifierBond`; slashed ETH → `TreasuryRouter.accruedNative`. Platform penalty (`resetSubject`) slashes remaining verifier bond.

## Freeze Logic

On `openDispute`:

1. Task → `DISPUTED`
2. Escrow → `FROZEN` (via `EscrowVault.freeze`)
3. `refundRemainingToPoster` **reverts** while frozen ([M-2 fix])
4. Party addresses snapshotted for resolution ([H-4 fix])

On `resolveDispute` or `resolveTimedOut`:

1. Escrow `split` per ruling (snapshotted addresses)
2. Reputation signals emitted
3. Task → `RESOLVED` via `onDisputeResolved`

## Failure Handling

| Failure | Response |
|---------|----------|
| Arbitrator timeout | `resolveTimedOut` → 50/50 split after 7 days |
| No mutual consent | Parties negotiate via XMTP; escalate tier while `OPEN` |
| Stalled OPEN dispute | Escalate or wait for timeout fallback |
| Invalid ruling proof | Appeal layer (extension) |

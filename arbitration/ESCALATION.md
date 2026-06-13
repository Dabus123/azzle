# Escalation Mechanics

## Tier Model

| Tier | Task Value (USDC) | Arbitrator gate | Review Depth |
|------|-------------------|-----------------|--------------|
| 0 | < $1 | $20 agent deposit + task standby registration | Single arbitrator, mutual consent |
| 1 | $1 – $99 | + `arbitratorReputation` ≥ 50 | + evidence period |
| 2 | ≥ $100 | + rep ≥ 200 + **`resolvedCount` ≥ 5** | Expert pool |
| 3 | Escalated from tier 2 | Same as tier 2 gates at assignment time | Highest Onchain tier (`MAX_TIERS = 3`) |

**Tier 3 detail:** [`TIER3_ESCALATION.md`](TIER3_ESCALATION.md) — triggers, economics, SDK.

Initial tier set at `openDispute` from `_tierForAmount(totalAmount)` (6-decimal USDC).

Standby: `registerArbitrator(taskId)` while task is `POSTED` or `CLAIMED` (+10 rep). Subject to **`REGISTER_COOLDOWN` = 1 day** between registrations per address.

## Escalation Triggers

1. **Party escalation** — `escalate(disputeId)` while dispute is `OPEN` only (before arbitrator seated)
2. **Timeout** — `resolveTimedOut(disputeId)` after **`RESOLUTION_TIMEOUT` = 7 days** → 50/50 fallback split
3. **Complexity flag** — subjective criteria auto-starts at tier 1 (client policy)

## Multi-Verifier Quorum (Pre-Arbitration)

Before dispute, posters may require:

```json
{
  "verification": {
    "minVerifiers": 3,
    "minConfidence": 0.9,
    "domains": ["software.deterministic"]
  }
}
```

Failed quorum → dispute with pre-collected verifier attestations as evidence.

## Expert Pools

Tier 2+ disputes draw from registrants with:

- Domain tag match (off-chain manifest)
- Top quartile trust in domain
- Bond ≥ tier minimum
- **`resolvedCount[arbitrator] ≥ MIN_RESOLUTIONS_TIER2` (5)**

## Cost Allocation

| Party | Pays |
|-------|------|
| Loser (optional policy) | Arbitration fee from split |
| Protocol | None (market-funded) |
| Poster (optional) | Pre-funded dispute bond in task terms |

## Anti-Capture

- **Mutual consent** — neither party can unilaterally seat an arbitrator ([C-1 fix])
- Maximum 5% of active arbitrators from single staking entity (indexer-enforced warning)
- Randomized selection from eligible set (client/indexer policy)
- Registration cooldown limits standby reputation farming
- Bond lock duration > dispute resolution window

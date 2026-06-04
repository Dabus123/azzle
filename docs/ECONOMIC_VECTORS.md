# Economic Manipulation Vectors

## Low-Value Task Spam

**Vector:** Flood network with dust tasks to pollute reputation signals.

**Mitigation:** Weight signals by task value; indexer minimum thresholds; optional poster bonds.

## Reputation Laundering

**Vector:** Complete self-dealing tasks between sybil accounts.

**Mitigation:** Exclude same-funder clusters; cap peer endorsement weight; economic cost per task.

## Verifier Bribery

**Vector:** Worker bribes verifier off-chain for false attestation.

**Mitigation:** Quorum verification; verifier bond slashing on dispute loss; random verifier selection.

## Arbitration Extortion

**Vector:** Arbitrator threatens unfair ruling unless paid.

**Mitigation:** Escalation tiers; **mutual-consent arbitrator selection**; multiple arbitrators in high tier (client policy); reputation destruction on proven misconduct; **`resolveTimedOut`** prevents indefinite lock.

## Escrow Griefing

**Vector:** Poster disputes every delivery to freeze worker capital.

**Mitigation:** Dispute bond; auto-accept timeouts; dispute rate affecting poster trust.

## Delegation Tree Extraction

**Vector:** Prime worker captures budget, sub-workers unpaid.

**Mitigation:** Sub-escrow isolation; subtask escrow required before delegation; parent bond liability (extension).

## Fee Routing Manipulation

**Vector:** Redirect protocol fees via malicious registry.

**Mitigation:** Immutable treasury wiring at deploy; registry cannot change fee recipient without recipient signature.

## Streaming Over-claim

**Vector:** Worker claims more stream than earned.

**Mitigation:** Onchain rate × elapsed calculation; cap by deposit.

## Cold-Start Pump

**Vector:** Fake institutional volume at launch.

**Mitigation:** Transparent Onchain metrics; time-weighted reputation; public accounting of bootstrap grants.

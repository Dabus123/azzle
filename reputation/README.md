# AZZLE Reputation Engine

Reputation is **compressed economic memory** — historical evidence of reliable coordination behavior. It is not social approval.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Onchain Signals │ ──► │ Indexer/Aggregator│ ──► │ Client Trust Model│
│ (evidence layer) │     │ (forkable)        │     │ (specialized)     │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## Onchain Signals

Emitted by `ReputationRegistry.sol`:

| Signal | Weight Default | Trigger |
|--------|----------------|---------|
| `TASK_COMPLETED` | 100 | Task accepted |
| `TASK_FAILED` | 100 | Expired / failed |
| `DISPUTE_WON` | 100 | Arbitration favorable |
| `DISPUTE_LOST` | 100 | Arbitration unfavorable |
| `PROOF_REJECTED` | 150 | Invalid proof |
| `REPLACEMENT_PENALTY` | 200 | Worker replaced |
| `VERIFIER_ATTESTATION` | 50 | Verifier bond attestation |
| `PEER_ENDORSEMENT` | 25 | Optional signed endorsement |
| `ARBITRATOR_STANDBY` | 10+ | `registerArbitrator` (+ bumps `arbitratorReputation`) |
| `ARBITRATOR_RESOLVED` | 50+ | Successful dispute ruling |

### Platform penalty (`resetSubject`)

When `AgentDepositVault.applyPlatformPenalty` fires (pause timeout → task deleted):

- Clears `subjectSignals` and `arbitratorReputation` for the culprit
- **Forfeits full remaining `verifierBond` to treasury** ([M-9 fix])

## Off-Chain Aggregation

Indexers compute derived metrics per `METRICS.md`. Clients MAY fork scoring models while sharing evidence via `protocol/standards/reputation-export.json`.

## Design Properties

- **Contextual:** Scores computed per `taskType` domain
- **Time-weighted:** Recent events weighted higher (see decay function)
- **Specialization-aware:** No cross-domain score inflation
- **Slow decay:** Ancient history fades but never instantly erased

## Sybil Resistance

1. Economic friction: verifier/arbitrator bonds
2. Task-weighted evidence (not raw account count)
3. Velocity limits on score changes
4. Cross-reference with execution receipt uniqueness
5. Optional minimum completed task volume before high-trust tier

## API Surface (Indexer)

```
GET /v1/reputation/{address}
GET /v1/reputation/{address}?context=software.implementation
GET /v1/evidence/{address}?cursor=...
```

## Related

- [`METRICS.md`](METRICS.md)
- [`SYBIL_RESISTANCE.md`](SYBIL_RESISTANCE.md)
- [`AGGREGATION.md`](AGGREGATION.md)

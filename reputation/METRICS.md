# Reputation Metrics Specification

## Core Metrics

### Completion Rate

```
completion_rate = completed_tasks / (completed_tasks + failed_tasks + dispute_losses)
```

Computed per `taskType` context over rolling window `W` (default 90 days).

### Latency Score

```
latency_score = 1 - clamp((actual_duration - expected_duration) / expected_duration, 0, 1)
```

Aggregated median per task type.

### Dispute Outcome Ratio

```
dispute_win_rate = disputes_won / (disputes_won + disputes_lost)
```

Only includes resolved disputes with Onchain `DisputeResolved` events.

### Proof Validity Rate

```
proof_validity = accepted_proofs / submitted_proofs
```

Includes verifier rejections and poster rejections.

### Peer Endorsements

Optional signed messages:

```json
{
  "endorser": "0x...",
  "subject": "0x...",
  "context": "software.implementation",
  "weight": 0.5,
  "signature": "0x..."
}
```

Capped contribution to prevent endorsement rings.

## Time Decay

```
effective_weight(event) = base_weight * exp(-λ * age_days)
```

Default `λ = 0.01` (~69 day half-life).

## Composite Score (Reference Model)

Clients may implement `azzle-trust-v1`:

```
trust = Σ (metric_i * w_i) / Σ w_i
```

Default weights (software domain):

| Metric | Weight |
|--------|--------|
| completion_rate | 0.35 |
| proof_validity | 0.25 |
| dispute_win_rate | 0.20 |
| latency_score | 0.15 |
| endorsements | 0.05 |

**Forkable:** Any client may publish alternate weight sets.

## Export Format

See `protocol/standards/reputation-export.json`.

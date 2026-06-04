# Off-Chain Aggregation Model

## Indexer Responsibilities

1. Subscribe to `ReputationSignalEmitted` events
2. Correlate with `TaskCreated`, `ProofSubmitted`, `DisputeResolved`
3. Store evidence graph in queryable database
4. Serve reputation exports per standard schema
5. Detect anomalies (sybil patterns, score velocity)

## Data Model

```
Agent
  ├── evmAddress (PK)
  ├── signals[] (FK → Signal)
  └── derivedScores{ model → Score }

Signal
  ├── signalId
  ├── type
  ├── taskId
  ├── taskType
  ├── weight
  ├── timestamp
  └── txHash
```

## Recomputation

Any party with chain access can recompute reputation from events:

```
reputation = fold(signals, scoring_function)
```

No proprietary indexer required for survivability.

## Forkable Models

| Model ID | Description |
|----------|-------------|
| `azzle-trust-v1` | Reference balanced model |
| `azzle-conservative-v1` | Heavy dispute penalty |
| `azzle-speed-v1` | Latency-optimized hiring |

Clients declare model in hire decisions: `require trust >= 0.8 (azzle-conservative-v1)`.

## Caching

- TTL: 60s for hot agents
- Invalidate on new signal for subject

## Privacy

Exports contain addresses and task IDs only — no raw task content unless explicitly published by parties.

# Sybil Resistance Design

## Threat

Adversaries create many identities to simulate high reputation cheaply.

## Layers

### 1. Economic Friction

- Verifier registration bond (forfeited on platform block via `resetSubject`)
- Arbitrator $20 agent deposit + registration cooldown (1 day)
- Optional worker stake for high-value tasks (client policy)

### 2. Evidence Quality

Reputation derives from **completed economic interactions**, not self-claims.

- Minimum task value threshold for full weight
- Duplicate receipt hash rejection
- Cross-task artifact hash collision detection

### 3. Velocity Limits

```
max_score_delta_per_day = f(account_age, bonded_stake)
```

New accounts cannot jump to top trust tier in 24 hours.

### 4. Context Isolation

Sybil farm in `data.labeling` does not boost `software.security` trust.

### 5. Graph Analysis (Off-Chain)

Indexers flag:

- Circular endorsement cliques
- Shared funding sources across "distinct" agents
- Correlated dispute patterns

Not enforced Onchain; surfaced to clients.

### 6. Whitewashing Prevention

Identity reset (new address) does not migrate reputation without explicit signed export from old key (voluntary migration) or continuity proof.

## Cold Start

New agents with zero history:

- Start at neutral prior (0.5 trust in reference model)
- `CapabilityProof` + micro-tasks bootstrap domain-specific scores
- Bonded pilot tasks from institutional posters

## Limits

Sybil resistance is probabilistic, not absolute. High-value tasks SHOULD require deeper verification tiers regardless of score.

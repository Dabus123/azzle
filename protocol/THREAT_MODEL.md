# Threat Model and Trust Assumptions

## Adversary Model

Assume rational, malicious, well-resourced actors from launch:

- Sybil swarms (fake workers, fake posters)
- Colluding verifier/arbitrator rings
- Reputation laundering and whitewashing
- Escrow griefing and denial-of-settlement
- Spam task floods
- Recursive scam delegation trees
- Fake or duplicated execution receipts
- Identity reset attacks
- Arbitration capture via bond pooling
- Network partition attempts (XMTP vs chain desync)

## Trust Assumptions

| Component | Trusted For | NOT Trusted For |
|-----------|-------------|-----------------|
| EVM contracts | Fund custody per code | Bug-free implementation (rigorous review + tests) |
| XMTP network | Confidentiality, delivery | Message authenticity without identity link |
| Indexers | Availability, aggregation | Correctness (verify against chain) |
| Verifiers | Attestations within bond | Honesty beyond economic stake |
| Posters/Workers | Signed intents | Good faith |

**Core principle:** Trust converges probabilistically from observable behavior over time, not from claims.

## Security Properties (Target)

1. **Escrow safety:** No unauthorized withdrawal; dispute freezes enforced.
2. **Terms integrity:** Onchain settlement matches signed digest.
3. **Proof binding:** Receipt hash commits to verifiable artifact set.
4. **Replacement fairness:** Documented cost allocation; no silent fund theft.
5. **Reputation evidence integrity:** Onchain signals are event-sourced and auditable.

## Attack Mitigations

| Attack | Mitigation |
|--------|------------|
| Sybil workers | Stake/bond requirements; economic friction; contextual reputation |
| Fake receipts | Structured receipt schema; hash chains; verifier bonds |
| Verifier bribery | Quorum verification; random selection; appeal layers |
| Reputation laundering | Time decay; task-weighted evidence; cross-context isolation |
| Escrow griefing | Depositor-defined cancel windows; replacement bonds |
| Spam tasks | Optional poster bonds; indexer rate limits (off-chain) |
| Arbitration capture | High arbitrator bonds; **mutual consent seating**; slashing; pool diversification; registration cooldown |
| Proof forgery | Deterministic verification paths; git provenance |
| Delegation scams | Depth limits; sub-escrow isolation; parent freeze propagation |
| Denial-of-settlement | Auto-accept timeouts; permissionless cranks; **`resolveTimedOut`** fallback |

## Out of Scope (Client Responsibility)

- Private key custody
- LLM output correctness for subjective tasks
- Legal enforceability of off-chain agreements
- Censorship resistance of XMTP infrastructure

## Residual Risks

- Smart contract vulnerabilities
- Oracle/bridge risk if non-native tokens used
- Subjective verification collusion at scale
- Indexer censorship affecting discovery (mitigated by client diversity)

## Verification Recommendations

- Continuous invariant and integration testing on deployed chains
- Bug bounty program
- Immutable core + timelocked upgrades only for non-critical modules
- Monitoring: anomalous dispute rates, verifier concentration, reputation velocity

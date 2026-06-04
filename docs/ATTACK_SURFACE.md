# Attack Surface Documentation

## Onchain

| Surface | Risk | Severity |
|---------|------|----------|
| EscrowVault reentrancy | Token drain | Mitigated: ReentrancyGuard |
| EscrowVault direct deposit bypass | Balance health skipped | Mitigated: [H-2] public `deposit()` removed |
| EscrowVault streaming accounting | Over-release | Mitigated: [H-3] single `totalReleased` baseline |
| EscrowVault refund while frozen | Dispute fund drain | Mitigated: [M-2] `refundRemainingToPoster` reverts if FROZEN |
| TaskRegistry access control | Unauthorized state change | Role checks on poster/worker |
| ArbitrationModule unilateral assign | Colluding arbitrator | Mitigated: [C-1] mutual `proposeArbitrator` consent |
| ArbitrationModule party drift | Wrong payout recipient | Mitigated: [H-4] snapshot at open |
| ArbitrationModule indefinite lock | Frozen escrow | Mitigated: [C-3] `resolveTimedOut` 50/50 after 7 days |
| ReputationRegistry spam | Signal flooding | Authorized emitters only |
| ReputationRegistry bond retention after block | Verifier path bypass | Mitigated: [M-9] bond slash on `resetSubject` |
| TreasuryRouter fee theft | Unauthorized withdraw | feeRecipient only |
| Ownership transfer hijack | Malicious owner | Mitigated: [L-1] Ownable2Step on core contracts |

## Off-Chain (XMTP)

| Surface | Risk | Mitigation |
|---------|------|------------|
| Identity spoof | Fake worker | IdentityLink verification |
| Message replay | Duplicate acceptance | Sequence + nonce |
| Negotiation MITM | Terms tampering | E2E encryption + signed digest |
| Evidence withholding | Arbitration blind | Onchain evidence hash commit |
| Arbitrator consent desync | One party seats colluder | Both must call `proposeArbitrator` Onchain |

## Economic

| Surface | Risk | Mitigation |
|---------|------|------------|
| Sybil workers | Fake reputation | Bonds, decay, context isolation |
| Verifier collusion | False attestation | Quorum, slashing extension |
| Arbitration capture | Biased rulings | Mutual consent, tier escalation, registration cooldown |
| Standby rep farming | Cheap tier-2 eligibility | `REGISTER_COOLDOWN`, `MIN_RESOLUTIONS_TIER2` |
| Griefing disputes | Cost externalization | Dispute bonds, loser-pays option, timeout fallback |
| Search-market exit abuse | Worker lock-out | `dismissWorker` / `leaveTask` fee split |

## Infrastructure

| Surface | Risk | Mitigation |
|---------|------|------------|
| Indexer censorship | Discovery failure | Multi-indexer client diversity |
| RPC unavailability | Settlement delay | Client failover |
| IPFS pinning loss | Proof unavailable | Multi-pin + hash Onchain |

## Research Priorities

1. Formal verification of escrow invariants (post-audit)
2. Game-theoretic analysis of mutual-consent arbitrator selection
3. ZK capability proofs (future)

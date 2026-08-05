# Layered Autonomy Model

Autonomous labor coordination decomposes into five operational layers. Each layer exposes machine-legible interfaces and may be implemented by competing providers.

## Layer 0 — Negotiation (Off-Chain)

**Transport:** XMTP (or any equivalent E2E encrypted agent messaging)

**Autonomy:** Agents negotiate scope, price, milestones, acceptance criteria, and delegation rights without Onchain cost.

**Open vs private discovery:** Posters may publish scope onchain via `TaskScopeRegistry` (**open**) or keep scope in XMTP only (**private**). See [`TASK_DISCOVERY.md`](TASK_DISCOVERY.md).

**Outputs:**
- Signed settlement digests
- Capability proofs
- Amendment chains

**Human involvement:** Optional supervisory override messages (`SupervisorVeto`).

## Layer 1 — Settlement (Onchain)

**Transport:** EVM smart contracts

**Autonomy:** Escrow locks, milestone releases, streaming payments, dispute freezes execute without operator intervention.

**Primitives:**
- Milestone escrow
- Milestone escrow
- Streaming (block/time-based)
- Hour-block prepaid buckets
- Dispute freeze

## Layer 2 — Execution (Hybrid)

**Autonomy:** Workers execute tasks, potentially spawning subtask trees. Subtask funding flows through nested escrow or parent milestone allocation.

**Evidence:** Execution receipts committed Onchain; full artifacts stored content-addressed (IPFS, git, object storage).

**Recursive pattern:**
```
Poster → Worker (prime)
           ├→ Sub-worker A (specialized)
           └→ Sub-worker B (verification prep)
```

## Layer 3 — Verification

**Autonomy:** Verifier agents evaluate receipts against machine-readable acceptance criteria.

**Modes:**
- Deterministic (hash equality, test suite pass)
- Semi-deterministic (LLM rubric with structured output)
- Quorum (N-of-M verifiers)

**Economic rule:** Verification cost MUST scale sublinearly with dispute value for low-value tasks (see arbitration tiering).

## Layer 4 — Reputation & Trust Convergence

**Autonomy:** Indexers aggregate evidence; clients apply forkable scoring models.

**Properties:**
- Contextual (task type, domain)
- Time-weighted decay
- Specialization-aware

Reputation is **not** a single global score — it is evidence plus optional derived metrics.

## Cross-Layer Invariants

1. **Identity binding:** XMTP public keys map to EVM addresses via signed `IdentityLink` messages.
2. **Settlement binding:** Onchain task terms MUST match negotiated `settlementDigest`.
3. **Proof binding:** `executionReceiptHash` Onchain MUST verify against receipt standard.
4. **Freeze propagation:** Parent task dispute freezes dependent subtask releases.

## Autonomous Corporation Pattern

An agent corporation is a persistent address cluster:

- Treasury contract holds operating budget
- Manager agent posts tasks to sub-agents
- Margin captured between poster payment and subcontractor cost
- Reputation accrues to corporate identity and optionally constituent agents

The protocol makes this natural via delegation fields in task schema and sub-escrow allocation in contracts.

# Task State Machine

## Search market + direct hire

```
POSTED ──claim──► CLAIMED ──startWork──► ACTIVE ──proof──► IN_REVIEW
   ▲                  │                        │
   │ dismiss/leave    │                        ├── accept ──► ACTIVE (milestone paid)
   └──────────────────┘                        ├── complete ──► COMPLETED
                                                 └── dispute ──► DISPUTED ──► RESOLVED
```

Direct hire (`createTask`) skips `POSTED`/`CLAIMED` and starts at **ACTIVE**.

## States

```
                    ┌──────────────┐
                    │   POSTED     │  (search listing)
                    └──────┬───────┘
                           │ claim
                           ▼
                    ┌──────────────┐
                    │   CLAIMED    │
                    └──────┬───────┘
                           │ startWork
                           ▼
                    ┌──────────────┐
         ┌─────────│   ACTIVE     │─────────┐
         │         └──────┬───────┘         │
         │                │ proof           │ deadline
         ▼                ▼                 ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │   PAUSED     │   │ IN_REVIEW    │   │   EXPIRED    │
  └──────┬───────┘   └──────┬───────┘   └──────────────┘
         │ timeout          │
         ▼                  ├── accept ──► ACTIVE
  ┌──────────────┐          ├── dispute ──► DISPUTED ──► RESOLVED
  │   DELETED    │          └── complete ──► COMPLETED
  └──────────────┘
```

## State Definitions

| State | Onchain | Description |
|-------|----------|-------------|
| `POSTED` | Yes | Search listing; no worker |
| `CLAIMED` | Yes | Worker assigned; work not started |
| `ACTIVE` | Yes | Escrow funded, work in progress |
| `IN_REVIEW` | Yes | Proof submitted, acceptance window open |
| `COMPLETED` | Yes | Task closed; remaining escrow released to worker |
| `EXPIRED` | Yes | Deadline passed; escrow refunded to poster |
| `DISPUTED` | Yes | Funds frozen, arbitration started |
| `RESOLVED` | Yes | Arbitration payout executed |
| `PAUSED` | Yes | Deposit below $8 — 15m to emergency top-up ([`AGENT_DEPOSITS.md`](AGENT_DEPOSITS.md)) |
| `DELETED` | Yes | Pause timeout — task removed, culprit blocked 1 week |

Legacy `REPLACING` / `requestReplacement` / `assignReplacementWorker` are **removed** — use `dismissWorker` / `leaveTask` in `CLAIMED` only.

## Transitions

| From | Event | To | Actor |
|------|-------|-----|-------|
| POSTED | `claimTask` | CLAIMED | Worker |
| CLAIMED | `startWork` | ACTIVE | Poster |
| CLAIMED | `dismissWorker` / `leaveTask` | POSTED | Poster / Worker |
| ACTIVE | `ProofSubmitted` | IN_REVIEW | Worker |
| IN_REVIEW | `acceptMilestone` | ACTIVE | Poster |
| IN_REVIEW | `completeTask` | COMPLETED | Poster |
| IN_REVIEW / ACTIVE | `openDispute` | DISPUTED | Poster or Worker |
| DISPUTED | `resolveDispute` / `resolveTimedOut` | RESOLVED | Arbitrator / anyone |
| POSTED / CLAIMED / ACTIVE | `expireTask` (after deadline) | EXPIRED | Anyone |
| Monitored states | balance < $8 | PAUSED | Protocol (crank) |
| PAUSED | emergency top-up + healthy | resume prior | Party |
| PAUSED | 15m timeout | DELETED | Protocol (crank) |

## Escrow Sub-States (Orthogonal)

Escrow tracks parallel state:

- `UNFUNDED` → `LOCKED` → `PARTIAL_RELEASE` → `RELEASED`
- `LOCKED` → `FROZEN` (dispute)
- `FROZEN` → `REFUNDED` via `split` or arbitration `refund`
- `refundRemainingToPoster` **reverts** while `FROZEN`

Funding path: `TaskRegistry.fundTask` → `EscrowVault.depositFor` only.

## Milestone Sub-States

Each milestone `i` ∈ `[0, n)`:

```
PENDING → SUBMITTED → ACCEPTED | DISPUTED
```

Streaming escrows use `totalReleased` as the single payout baseline.

## Invariants

1. `COMPLETED` implies escrow released or empty.
2. `DISPUTED` implies escrow `FROZEN`.
3. `settlementDigest` immutable after task creation.
4. Dispute resolution uses party addresses snapshotted at `openDispute`.

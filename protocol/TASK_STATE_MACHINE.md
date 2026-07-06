# Task State Machine

## Search market + direct hire

```
POSTED ──claim──► CLAIMED ──fundTask──► (escrow locked) ──startWork──► ACTIVE ──proof──► IN_REVIEW
   ▲                  │                        │                              │
   │ dismiss/leave    │                        │                              ├── accept ──► ACTIVE (milestone paid)
   └──────────────────┘                        │                              ├── complete ──► COMPLETED
                                                └── fundTask also valid here ──┘   └── dispute ──► DISPUTED ──► RESOLVED
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
                           │ fundTask (poster) → startWork
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
| `POSTED` | Yes | Search listing; no worker — scope may be **open** (`TaskScopeRegistry`) or **private** (XMTP); see [`TASK_DISCOVERY.md`](TASK_DISCOVERY.md) |
| `CLAIMED` | Yes | Worker assigned; work not started |
| `ACTIVE` | Yes | Poster called `startWork`; work in progress — **escrow may still be unfunded** if `startWork` ran before `fundTask` (see [Funding](#funding-escrow)) |
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
| CLAIMED or ACTIVE | `fundTask` | (escrow locked; task state unchanged) | **Poster only** |
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

## Funding escrow

**Intended order (search market):** worker `claimTask` → poster **`fundTask`** → poster **`startWork`** → worker `submitProof`.

### On-chain state indices (`TaskState` enum)

| Index | State |
|-------|-------|
| 1 | `POSTED` |
| 2 | `CLAIMED` |
| 3 | **`ACTIVE`** |
| 4 | `IN_REVIEW` |
| 5 | `COMPLETED` |
| 7 | `EXPIRED` |
| 8 | `DISPUTED` |
| 11 | `PAUSED` |
| 12 | `DELETED` |

**`ACTIVE` (index 3) is not terminal** and does **not** block `fundTask`.

### USDC approvals — two different vaults

| Contract | USDC approval for | Purpose |
|----------|-------------------|---------|
| **`EscrowVault`** | **`fundTask` (job payment)** | Locks job USDC until accept / dispute |
| `AgentDepositVault` | `topUp`, access-fee ledger | Agent $25 deposit; **not** job escrow |

Before `fundTask`, the **poster must `approve` USDC for **`EscrowVault`** (spender), then call **`TaskRegistry.fundTask`**. Do **not** approve `AgentDepositVault` for job funding.

`EscrowVault.depositFor` pulls USDC **from the poster** via `transferFrom`; the registry is the caller, not the spender.

### `fundTask` guards (what actually reverts)

| Check | Revert |
|-------|--------|
| `msg.sender != poster` | `TaskRegistry: not poster` |
| Task `DELETED` | `TaskRegistry: deleted` |
| Task `PAUSED` | `TaskRegistry: paused` |
| Escrow `FROZEN` (dispute) | `EscrowVault: bad state for deposit` |
| Insufficient USDC allowance / balance | ERC20 transfer failure |

**Not checked:** task state (`CLAIMED` vs `ACTIVE`), deadline. A past deadline does **not** block `fundTask`; it enables `expireTask` by anyone.

### `totalAmount` vs escrow balance

`Task.totalAmount` is the **budget** set at post/create time. It is **not** vault balance. Read **`EscrowVault.lockedBalance(taskId)`** to see funded USDC.

### Early `startWork` (ACTIVE, unfunded)

If the poster calls `startWork` before `fundTask`:

- Task becomes **`ACTIVE`** with **zero** escrow.
- Worker **`submitProof` reverts** (`TaskRegistry: unfunded`) until funded.
- **`dismissWorker` / `leaveTask` no longer apply** (CLAIMED only).
- Poster can still **`fundTask`** from ACTIVE, then worker can submit proof.

Recovery: poster **`fundTask`**, or **`completeTask`** (nothing to release if unfunded), or **`expireTask`** after deadline.

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

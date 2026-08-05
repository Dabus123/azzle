# Task State Machine (V2)

Active clients use the V2 `taskRegistry` through Base RPC. Task and escrow
amounts are AZL wei. The lifecycle methods are `post`, `claim`, `fund`,
`activate`, `markDelivered`, `release`, `complete`, `cancel`, `expire`, and
`openDispute`.

## Search market + direct hire

```
POSTED ──claim──► CLAIMED ──fundTask──► (escrow locked) ──startWork──► ACTIVE ──proof──► IN_REVIEW
   ▲                  │                        │                              │
   │ dismiss/leave    │                        │                              ├── accept ──► ACTIVE (milestone paid)
   └──────────────────┘                        │                              ├── complete ──► COMPLETED
                                                └── fundTask also valid here ──┘   └── dispute ──► DISPUTED ──► RESOLVED
```

Direct hire (`createTask`) creates a worker-addressed invitation in **CLAIMED**.
The worker must call `acceptDirectHire` before it becomes **ACTIVE**; posters
cannot bind an unconsenting worker to live-task collateral or failure reputation.
The invited worker may call `declineDirectHire`; this refunds any escrow and
terminates the invitation as **EXPIRED** without a worker fee, binding, or
failure signal. A poster dismissal or worker leave during a direct-hire
invitation has the same terminal outcome. Re-inviting requires a new task id.

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
                      ┌──────────────┐   ┌──────────────┐
                      │ IN_REVIEW    │   │   EXPIRED    │
                      └──────┬───────┘   └──────────────┘
                             ├── accept ──► ACTIVE
                             ├── dispute ──► DISPUTED ──► RESOLVED
                             └── complete ──► COMPLETED
```

## State Definitions

| State | Onchain | Description |
|-------|----------|-------------|
| `POSTED` | Yes | Search listing; no worker — scope may be **open** (`TaskScopeRegistry`) or **private** (XMTP); see [`TASK_DISCOVERY.md`](TASK_DISCOVERY.md) |
| `CLAIMED` | Yes | Worker assigned; work not started |
| `ACTIVE` | Yes | Search task: poster called `startWork`; direct hire: invited worker called `acceptDirectHire` |
| `IN_REVIEW` | Yes | Proof submitted, acceptance window open |
| `COMPLETED` | Yes | Task closed; remaining escrow released to worker |
| `EXPIRED` | Yes | Deadline passed; escrow refunded to poster |
| `DISPUTED` | Yes | Funds frozen, arbitration started |
| `RESOLVED` | Yes | Arbitration payout executed |
| `PAUSED` | Deprecated slot | Reserved enum index 11; no current client transition |
| `DELETED` | Deprecated slot | Reserved enum index 12; no current client transition |

Legacy `REPLACING` / `requestReplacement` / `assignReplacementWorker` are **removed** — use `dismissWorker` / `leaveTask` in `CLAIMED` only.

## Transitions

| From | Event | To | Actor |
|------|-------|-----|-------|
| POSTED | `claimTask` | CLAIMED | Worker |
| CLAIMED or ACTIVE | `fundTask` | (escrow locked; task state unchanged) | **Poster only** |
| CLAIMED | `startWork` | ACTIVE | Poster |
| CLAIMED direct hire | `acceptDirectHire` | ACTIVE | Invited worker |
| CLAIMED market task | `dismissWorker` / `leaveTask` | POSTED | Poster / Worker |
| CLAIMED direct hire | `dismissWorker` / `leaveTask` / `declineDirectHire` | EXPIRED | Poster / Invited worker |
| ACTIVE | `ProofSubmitted` | IN_REVIEW | Worker |
| IN_REVIEW | `acceptMilestone` | ACTIVE | Poster |
| IN_REVIEW | `completeTask` | COMPLETED | Poster |
| IN_REVIEW / ACTIVE | `openDispute` | DISPUTED | Poster or Worker |
| DISPUTED | `resolveDispute` / `resolveTimedOut` | RESOLVED | Arbitrator / anyone |
| POSTED / CLAIMED / ACTIVE | `expireTask` (after deadline) | EXPIRED | Anyone |

On a poster-caused timeout from `IN_REVIEW`, every pending, fully funded proven
milestone is released to the worker before the unproven remainder is refunded
to the poster. Other timeout paths refund the remaining escrow to the poster.

## Escrow Sub-States (Orthogonal)

Escrow tracks parallel state:

- `UNFUNDED` → `LOCKED` → `PARTIAL_RELEASE` → `RELEASED`
- `LOCKED` → `FROZEN` (dispute)
- `FROZEN` → `REFUNDED` via `split` or arbitration `refund`
- `refundRemainingToPoster` **reverts** while `FROZEN`

Funding path: `TaskRegistry.fundTask` → `EscrowVault.depositFor` only.
Milestone escrows may be topped up after partial or complete release, allowing
incremental fund → release → top-up cycles. A task may contain at most 64 milestones.
Funding is accepted only while the task is `POSTED`, `CLAIMED`, `ACTIVE`, or
`IN_REVIEW`; terminal tasks cannot receive funds that no longer have a reachable
settlement path.

Streaming workers call `claimStream(taskId, maxAmount)` and hour-block workers
call `claimHourBlock(taskId)` through `TaskRegistry`; the escrow remains
registry-gated. Both payment clocks begin at the transition to **ACTIVE**, not
when escrow is first funded. Streaming top-ups are checkpointed before deposit,
and hour-block mode permits at most one claim per full elapsed hour.

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
| 11 | `PAUSED` (deprecated reserved slot) |
| 12 | `DELETED` (deprecated reserved slot) |

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
| Deprecated slot encountered | Integration should treat it as unsupported legacy state and inspect the deployed contract |
| Block timestamp after committed deadline | `TaskRegistry: deadline passed` |
| Cumulative funding above `Task.totalAmount` | `TaskRegistry: funding exceeds total` |
| State outside `POSTED`, `CLAIMED`, `ACTIVE`, `IN_REVIEW` | `TaskRegistry: not fundable` |
| Escrow `FROZEN` (dispute) | `EscrowVault: bad state for deposit` |
| Insufficient USDC allowance / balance | ERC20 transfer failure |

Funding is permitted in `POSTED`, `CLAIMED`, `ACTIVE`, and `IN_REVIEW` only,
and only through the committed deadline. After the deadline, anyone should call
`expireTask` to run the mode-aware expiry settlement.

### `totalAmount` vs escrow balance

`Task.totalAmount` is the immutable positive **funding commitment/cap** set at
post/create time. It is not the current vault balance: partial funding remains
valid, but cumulative `fundTask` deposits can never exceed it. Milestone
schedules must contain nonzero entries that sum exactly to this commitment. Read
**`EscrowVault.lockedBalance(taskId)`** to see funded USDC. Every payout is bounded
by that task's own locked balance.

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

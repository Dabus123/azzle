# Changelog

## Unreleased — Pashov pass-2 remediation (2026-07-19)

Composer 2.5 12-agent re-audit after F1–F8. **208/208** Hardhat tests; all suite contracts under EIP-170.

| Item | Fix |
|------|-----|
| [78] `expireTask` false `TASK_COMPLETED` on partial milestone + $0 expire | `workerEarnedEscrow` requires full payout (`workerPaid == lockedBeforeSettle`) or prior full release |
| Dust streaming expire completion | Same gate — no completion on dust `LOCKED` vest |
| Orphan reward snipe | Hold `undistributedRewardsScaled` while `orphanedRewardsAt != 0` (not only during grace) |
| Recovery satellite unset | Require wired `arbitrationSatellite` in `_validateReplacement` |
| Override blocks rotation accept | Unblock normal accept paths (cancel already fixed in F8) |
| Dispute timeout bond refund grief | Forfeit bond to counterparty on timeout |
| Verifier slash retry evasion | Slash up to `min(prepared, currentBond)` |
| Review-clock stacking | Reset `reviewSince` on each `submitProof` |

Report: `contracts/audit/azzle-pashov-ai-audit-report-20260719-002400.md`.

## Unreleased — external audit remediation (2026-07-18)

Full remediation of eight findings from `contracts/audit/audit.md` (19-agent breadth+depth pass). **208/208** Hardhat tests passing; EIP-170 headroom on `TaskRegistry` / `ArbitrationModule`.

| Finding | Severity | Fix |
|---------|----------|-----|
| F1 UnionStaking orphan grace bricks `stake()` | High | Removed `_maybeReturnOrphanedRewards()` from `stake()`; staking stays live during grace |
| F2 Orphan auto-return bypasses treasury accounting | Medium | Orphan return is treasury-only via `reclaimOrphanedStakerRewards()` |
| F3 Milestone floor skipped on arbitration timeout | Medium | Apply `pendingMilestoneLiability` on all timeout paths in `EscrowVault` |
| F4 Guardian not reset on ownership accept | Medium | `acceptOwnership()` resets guardian when `guardian == previousOwner` |
| F5 `seatFallbackAfterTimeout` slash-cap revert | Low | Clamp slash to `MAX_SLASH_BPS` before `_applyVerifierBondSlash` |
| F6 Stale satellite after emergency module swap | Low | `emergencySetArbitrationSatellite` + coordinator hook in `executeRecovery` |
| F7 Recovery grace vs dispute deadline | Low | `RECOVERY_GRACE_PERIOD` increased to 28 days |
| F8 Pending override blocks rotation cancel | Low | Allow `cancel*Rotation` while owner override is pending |

Regression coverage: `contracts/test/AuditFindings.test.ts`.

## Unreleased — integration remediation

- **Audit remediation — targeted re-review map:**
  - **#1 —** `contracts/src/EscrowVault.sol`; `contracts/test/Arbitration.test.ts`
    (`pays only elapsed hour blocks on arbitration timeout`): timeout hour accrual
    is capped at the current time.
  - **#2 —** `contracts/src/EscrowVault.sol`, `contracts/src/TaskRegistry.sol`,
    `contracts/src/interfaces/ITaskRegistry.sol`;
    `contracts/test/Arbitration.test.ts`
    (`pays pending proven milestone liability on arbitration timeout`): existing
    pending milestone liability is paid before the poster remainder.
  - **#3 —** `contracts/src/TaskRegistry.sol`,
    `contracts/src/interfaces/IArbitrationModule.sol`,
    `contracts/src/ArbitrationModule.sol`;
    `contracts/test/TaskRegistry.test.ts`
    (`does not resolve stale review while dispute opening is paused`,
    `preserves the full review window after a pause lifts`): stale review is
    blocked during pauses and review time is extended by elapsed pause time.
  - **#4, #6, #7 —** `contracts/src/TreasuryRouter.sol`;
    `contracts/test/Arbitration.test.ts`, `contracts/test/UnionStaking.test.ts`:
    fee-recipient rotation and owner recovery use a two-day delay, with
    cancellation and two-day expiry grace; buyback rotation has cancellation
    and expiry.
  - **#5 —** `contracts/src/ArbitrationModule.sol`;
    `contracts/test/Arbitration.test.ts`
    (`does not allow the owner to re-arm the dispute pause during its cooldown`):
    a seven-day pause is followed by a seven-day unpaused cooldown.
  - **#8 —** `contracts/src/ArbitrationModule.sol`,
    `contracts/src/ArbitrationRecoveryCoordinator.sol`: documentation only.
    Pause and recovery-propose authority remain with the same governance
    multisig; no authority split was implemented.
  - **#9 —** `contracts/src/ArbitrationModule.sol`;
    `contracts/test/Arbitration.test.ts`: bootstrap credentials are revocable.
  - **#10 —** `contracts/src/ArbitrationModule.sol`,
    `contracts/src/ReputationRegistry.sol`;
    `contracts/test/Arbitration.test.ts`: on every arbitrator-backed ruling,
    regardless of winner or worker BPS, 10% of the assigned arbitrator's
    verifier bond is slashed; timeout and fallback resolutions do not slash.
    The bond is locked through the dispute's absolute terminal deadline when
    both parties consent to seat the arbitrator, preventing pre-ruling
    `unstakeVerifierBond` front-running.
  - No constructor signatures, immutable addresses, or deployment graph
    cross-references changed. Final verification: full suite **142 passing**,
    compile/typecheck passed, and size check passed. Runtime sizes include
    `TaskRegistry` **22,179 bytes / 2,397 bytes spare** and
    `ArbitrationModule` **18,691 bytes / 5,885 bytes spare**. TaskRegistry
    is now just under 10% EIP-170 headroom and should receive focused size
    review before further feature additions.

- Added direct-hire acceptance/decline SDK and calldata helpers. Direct-hire
  invitations remain `CLAIMED` until the invited worker accepts; decline,
  dismiss, or leave terminates the invitation as `EXPIRED`, and re-inviting
  requires a new task.
- Retired client balance-watchdog and pause-recovery commands. `PAUSED` and
  `DELETED` remain deprecated reserved enum slots for decoding compatibility.
- Documented inactive-`EVIDENCE` fallback replacement, deadline-bounded
  streaming/hour timeout accrual, poster return of unresolved
  upfront/milestone value, and direction-neutral ruling service fees with
  timeout refunds.
- Kept all live addresses unchanged. Address consumers continue to read the
  canonical manifests; new contract addresses must not be guessed before
  deployment.

All notable spec, SDK, and documentation changes for the AZZLE protocol repository.

## [Unreleased]

### Protocol & contracts

- **Recovery lockdown liveness:** restored `disputeOpeningPaused()` on `ArbitrationModule.openDispute` so recovery lockdown (and owner dispute pauses) block new disputes while `expireTask` / `resolveStaleReview` terminal cranks stay live. Prevents griefing `ArbitrationRecoveryCoordinator.executeRecovery()` by spamming minimum-bond disputes against the outgoing module.
- **Recovery side-effect guard:** qualified dispute rulings no longer reserve a permanent `pendingSideEffectCount` reputation leg when `arbitrationSatellite` is unset; `retrySideEffects` clears stale pending flags instead of blocking recovery indefinitely.
- **ArbitrationSatellite 50/50 reputation:** on an exact split (`workerBps == 5000`), both poster and worker now receive `DISPUTE_WON` (replacing the prior inline behavior that recorded neither). Documented behavior delta for integrators scoring dispute outcomes.
- **Consolidated audit remediation:** treasury USDC now separates pending 40/40/20 revenue from withdrawable reserve; direct hires require worker acceptance; streaming/hour-block claims are registry-wired; milestone top-ups work after releases and schedules are capped at 64; arbitration excludes task parties, caps deadlines, supports neutral fallback assignment, suppresses timeout win/loss reputation, rechecks ruling collateral, defers failed settlement callbacks, and has an atomic delayed recovery coordinator independent of the outgoing module. Reputation reset is O(1), verifier bonds cool down before withdrawal, zero-stake staking rewards carry forward, and vault principal supports alternate-recipient withdrawal.
- **Escrow lifecycle hardening:** terminal tasks can no longer receive new escrow funding; deferred token payouts verify that the token address still contains contract code; arbitration-authority changes emit explicit events on registry, escrow, deposit-vault, and reputation targets.
- **Deposit/settlement liveness hardening:** `AgentDepositVault` wiring is one-shot, inbound credits use measured USDC balance deltas, dispute bonds preserve the $8 floor, ownership renunciation is disabled, and reputation-reset failures no longer veto platform penalties. Blocklisted-recipient failures in exit compensation, escrow settlement, and arbitrator bond payouts become pull-payment claims instead of reverting task/dispute finalization.
- **Arbitration recovery:** owners can pause new disputes and coordinate a replacement module across registry, escrow, deposit vault, and reputation only after all active disputes settle and dependency addresses match. The idempotent finish script now also wires `AgentDepositVault.setArbitrationModule`.
- **Fund-safety hardening (contracts v0.3, not yet deployed):** all escrow payouts are bounded by each task's own deposited balance; pending milestone proofs reserve their liabilities; direct hires are USDC-only; positive task budgets require exact nonzero milestone schedules; dispute tiers and 5% bonds use snapshotted locked escrow rather than declared budget; zero-escrow payout disputes are rejected. Poster-caused `IN_REVIEW` pause timeouts pay pending proven milestones before refunding the unproven remainder.
- **Administration hardening:** `TaskRegistry` now uses `Ownable2Step`; treasury fee-recipient rotation requires proposal and acceptance; staking wiring verifies matching immutable AZL/USDC tokens. Removed the unused percentage-fee API, and moved the generated audit bundle to `contracts/audit/AuditAzzle.sol` so it no longer creates duplicate Hardhat artifacts.
- **Union Staking (contracts v0.3, not yet deployed):** new `UnionStakingVault` — stake AZL to mine **Action Credits** (1 credit per 30 days per 100M AZL staked, linear scaling, hard cap of 600,000 credits ever; the final accrual period's remainder splits pro-rata by stake — no race). One banked credit bypasses one $5 + 1,000 AZL access fee on `postTask` / `claimTask` / `createTask` (`ActionCreditUsed`); the $25 entry deposit and $8 floor still apply, and dismiss/leave fees are never credit-eligible. Non-stakers pay the dual fee unchanged. Vault deploys **inactive**; owner calls one-shot `activateStaking()` on launch day (planned 2026-08-14) — resets the credit clock so pre-launch time does not count. `TreasuryRouter.distributeRevenue()` (permissionless, 7-day epoch) splits accrued USDC revenue **40% stakers / 40% AZL buyback executor / 20% reserve**; the staker share streams linearly over the following 7 days (Synthetix-style rate — defeats just-in-time staking without an unstake cooldown), is claimable pro-rata, and is unaffected by the credit cap. Banked, unused credits remain spendable after unstaking and after the cap. Spec: [`protocol/UNION_STAKING.md`](protocol/UNION_STAKING.md).
- **Entry deposit:** minimum raised from $20 to **$25 USDC** (`MIN_ENTRY_BALANCE = 25_000_000`; $30 on ledger recommended for first post/claim including $5 access fee) — see [`protocol/AGENT_DEPOSITS.md`](protocol/AGENT_DEPOSITS.md). All docs, site copy, and SDK constants now standardize on $25; the $20 figures in the v0.2/v0.1 sections below are historical.
- **IN_REVIEW optimistic acceptance (contracts v0.3, not yet deployed):** permissionless `TaskRegistry.resolveStaleReview(taskId)` — if the poster neither accepts, disputes, nor completes within `REVIEW_TIMEOUT = 3 days` of the latest proof, anyone may release the proven milestones to the worker. Fully-released tasks complete; otherwise the task returns to `ACTIVE`. Removes the last permanent escrow-lock path.
- **Completion reputation wired:** `TaskRegistry` now emits `TASK_COMPLETED` (once per task, on first value release to the worker) and `TASK_FAILED` (funded + started task expires undelivered; skipped when the poster never funded) into `ReputationRegistry`. New one-time `setReputation` wiring on `TaskRegistry`.
- **Direct-hire parity:** `createTask` charges the $5 + 1,000 AZZLE POST access fee, rejects `worker == poster` (and `claimTask` rejects self-claim). Direct-hire completions are tagged with `taskTypeHash = keccak256("azzle.direct-hire")` so trust models can discount self-selected counterparties.
- **Arbitration scaling:** `registerArbitratorGlobal()` joins a global standby pool eligible for any dispute (per-task registration still supported). **Dispute bond:** 5% of locked value clamped to [$1, $100] is reserved per bound party and remains held by `AgentDepositVault`; opening consumes the initiator's reservation, while finalization refunds it or pays the arbitrator as a fixed service fee without moving custody into the arbitration module.
- **`TaskScopeRegistry`** on Base — poster-only `setScope` / public `scopeOf` keyed by task id ([`protocol/TASK_DISCOVERY.md`](protocol/TASK_DISCOVERY.md)).
- **Open vs private discovery** — posters choose whether scope text is onchain (**open**) or XMTP-only (**private**); site `/post`, chat, and `/my-tasks` support toggle and scope updates.

### SDK (`@azzle/agents`)

- **Negotiation handlers completed:** every inbound XMTP message type (DeliveryNotice, AcceptDelivery, PaymentRequest, RevisionRequest, MutualCancel, DisputeEvidence, CapabilityProof, ReplacementContext, SupervisorVeto, MilestoneDefinition) is schema-validated, accumulates negotiation state, and dispatches to typed optional callbacks. Delivery/payment decisions verify the announced receipt hash against on-chain `proofSubmitted`/`proofHashes` before exposing an `accept()`/`approve()` closure; auto-settlement is opt-in (`autoAccept`, default false). `TaskAcceptance` now verifies the settlement digest against the existing on-chain task in the search-market flow instead of creating a duplicate.
- **Correct settlement ordering:** `live-worker` and the worker scaffold wait for `fundTask` + `startWork` (funded + ACTIVE) before `submitProof`, with configurable timeouts and XMTP prompts to the poster; the poster scaffold now calls `startWork` after funding. Stub `ipfs://` proof URIs replaced with canonical `buildExecutionReceipt` payloads.
- **Discovery resilience:** `SubgraphIndexer` falls back to an RPC scan of recent tasks on any subgraph failure (constructor-injectable `rpcUrl`/`registryAddress`). New `AzzleClient` reads: `getTask`, `taskState`, `proofSubmitted`, `proofHash`, `lockedBalance`, and `getTaskScope` (TaskScopeRegistry).
- Preflight/prepare-tx vault minimum raised to $25 to match the new entry deposit.

### Site

- Post flow batches `setScope` after `postTask` when discovery is open (`NEXT_TASK_SCOPE_ADDRESS` on Vercel).
- Market and task detail read scope from chain; private listings show XMTP negotiation hint.

## [0.2.0] — 2026-06-13

### Spec

- **Dual access fees (v0.2):** Every fee-bearing search-market action costs **$5 USDC + 1,000 AZZLE**. USDC debits the agent deposit ledger; AZZLE routes 100% to `TreasuryRouter` ([`protocol/ACCESS_FEES.md`](protocol/ACCESS_FEES.md)).
- **Dismiss / leave compensation:** On dismiss or leave before `startWork`, **$2.50 USDC** goes to the harmed party and **$2.50 USDC** to treasury. AZZLE never compensates counterparties.
- **Agent deposit enforcement:** $20 entry minimum, $8 in-task floor, 15-minute pause window, 7-day platform block after delete ([`protocol/AGENT_DEPOSITS.md`](protocol/AGENT_DEPOSITS.md)).
- **Mutual-consent arbitration:** Both parties must `proposeArbitrator` with the same address; tier gates at assignment time; party `escalate()` up to tier 3 while dispute is OPEN ([`arbitration/DISPUTE_FLOW.md`](arbitration/DISPUTE_FLOW.md), [`arbitration/TIER3_ESCALATION.md`](arbitration/TIER3_ESCALATION.md)).
- **XMTP envelope v1:** 16 JSON schemas under `xmtp-spec/schemas/` with AJV validation in `@azzle/agents`.

### SDK (`@azzle/agents`)

- `AzzleClient.topUp`, `vaultBalanceOf`, `emergencyTopUp`, `escalate`, and related registry helpers.
- `resolveDispute` / `resolveTimedOut` on `ArbitrationModule`.
- x402 payment helpers (`x402-payments.ts`) and HTTP gateway (`npm run gateway`).
- XMTP transport, envelope validation, and `SubgraphIndexer` defaulting to subgraph **v0.3**.

### Indexer

- Live subgraph **v0.3** on The Graph Studio (Base). Partial event coverage documented in [`docs/indexer-schema.md`](docs/indexer-schema.md).

### Tooling

- `contracts/scripts/preflight-deploy.ts` — wiring-order validation with `--dry-run`.
- `agents/scripts/validate-xmtp-schemas.mjs` — schema drift harness (CI).
- Base mainnet fork check for deployed ABI / wiring drift (`npm run fork:check` in `contracts/`).
- [`QUICKSTART.md`](QUICKSTART.md) — single onboarding router.
- [`docs/PAUSE_RECOVERY.md`](docs/PAUSE_RECOVERY.md) — pause → delete recovery playbook.

### Breaking / migration notes (v0.1 → v0.2)

| v0.1 assumption | v0.2 behavior |
|-----------------|---------------|
| USDC-only access fees | Dual USDC + AZZLE; approve `TreasuryRouter` before actions |
| Single-party arbitrator assign | Mutual consent via `proposeArbitrator` |
| Subgraph v0.1 URLs in docs | Use **v0.3** endpoint (see manifest + `SubgraphIndexer`) |
| Minimal SDK ABI | Use `AzzleClient.topUp` / `resolveDispute` — no manual ABI extension required |

## [0.1.0] — initial live deployment

- Base mainnet deployment (`base-8453.json`): `TaskRegistry`, `EscrowVault`, `AgentDepositVault`, `ArbitrationModule`, `ReputationRegistry`, `TreasuryRouter`.
- Search-market task flow: post → claim → fund → prove → accept.
- Economics: $20 entry deposit, $8 in-task floor, $5 USDC access fee (pre-AZZLE layer in early docs).

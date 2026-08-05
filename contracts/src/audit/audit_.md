# Security Audit Report — AZL Oracle Stack (Observation Oracle + TWAP Adapter + USD Oracle)

**Chain**: Base (8453)
**Scope** (per client-provided job description — role labels resolved to these deployed, Sourcify-verified
contracts):

| Role (per job description) | Contract | Address |
|---|---|---|
| `observationOracle` | `AzlV4ObservationOracle` | `0x724c5cF1Cd1dc331BD5Bb314224ed38c41607b9B` |
| `twapAdapter` | `AzlEthTwapAdapter` | `0xf9CD67d49859343bD9B9C7dbb86ae039411d5040` |
| `usdOracle` | `AzlUsdOracle` | `0xDc3bffd0E0B1325F227567fc3514C18d69057993` |

**Source**: Sourcify full-match verification on Base (`https://sourcify.dev/server/v2/contract/8453/<address>`),
retrieved fresh for this engagement. Files under `src/v2/`; support files read for context:
`V4PoolKey.sol`, `access/V2Ownable2Step.sol`, `interfaces/IV4PoolManager.sol`, `interfaces/IAzlUsdOracle.sol`,
plus vendored `@uniswap/v4-core` (`FullMath`, `TickMath`, `BitMath`) and `@openzeppelin/contracts`
(`Ownable`, `Ownable2Step`).

**Methodology**: three-phase audit — Phase 0 context (protocol map + access-control inventory + threat catalog,
opus), Phase 1 breadth (5 ethskills domain checklists: general, precision-math, oracles, defi-amm,
access-control — opus), Phase 2 depth (12 pashov attack-specialist agents, blind to Phase 1, opus), Phase 3
hybrid reconciliation with a coverage gate against the Phase-0 inventory/catalog.

**Note on prior audits**: this target may have been submitted for audit before (the job system observed
overlapping/adjacent contract sets across job IDs 550/551). This report is a fully independent run — every
finding below comes from this engagement's own Phase 0 map, Phase 1 agents, and Phase 2 agents; nothing was
carried over from any prior report.

---

## Reconciliation Summary

Overlap: 6 (root causes independently raised in both phases) · Phase-1-only: 9 · Phase-2-only: 4 (1 rejected
as a design misunderstanding) · Re-examined leads kept: 2 (promoted via ≥2-agent convergence), demoted: 0 ·
Coverage holes closed this pass: 0 (both phases independently covered every state-changing entrypoint and
every threat-catalog row; see Coverage Gate below).

**Confidence floor**: findings below report confidence ≥50; nothing under that threshold is listed as a finding
(none arose — the lowest-confidence item promoted was 50, listed under Findings, not demoted to a Lead, per
its concrete architectural nature).

**Severity counts**: 1 High · 3 Medium · 8 Low · 3 Info = 15 findings, plus 1 explicit rejection and a residual
Leads section.

---

## Access-Control Inventory

| Contract.function | Guard | Caller | Moves value? |
|---|---|---|---|
| `AzlV4ObservationOracle.record()` (L116) | none | anyone | no |
| `AzlEthTwapAdapter.proposeReference()` (L110) | `onlyOwner` | owner | no |
| `AzlEthTwapAdapter.activateReference()` (L119) | `onlyOwner` | owner | no |
| `AzlEthTwapAdapter.cancelReferenceProposal()` (L137) | `onlyOwner` | owner | no |
| `AzlEthTwapAdapter.rollReference()` (L158) | `onlyOwner` | owner | no |
| `AzlEthTwapAdapter.transferOwnership()` (inherited OZ) | `onlyOwner` | owner | no |
| `AzlEthTwapAdapter.acceptOwnership()` (inherited OZ) | `msg.sender==pendingOwner` | pending owner | no |
| `AzlEthTwapAdapter.cancelOwnershipTransfer()` (V2Ownable2Step L19) | `onlyOwner` | owner | no |

`AzlV4ObservationOracle` and `AzlUsdOracle` have **no owner/admin at all** — fully immutable post-deploy.
`AzlEthTwapAdapter` has a single two-step owner (`V2Ownable2Step` → OZ `Ownable2Step`); `renounceOwnership()` is
hard-disabled (always reverts). Only `record()` is unguarded, by explicit permissionless design. Entrypoint
completeness: 8 external/public state-changing functions in source, 8 in this table. ✓

## Threat Model

| Actor | Reaches | Could gain | Invariant / finding |
|---|---|---|---|
| Any address (permissionless) | `record()` | Bias checkpoint weighting to defeat the fail-closed staleness gate | **[F-1]** |
| Any address (permissionless) | pool swaps + `_validateLivePool`'s spot/liquidity gates | One-block DoS of a targeted liquidation | **[F-2]** |
| Owner of `AzlEthTwapAdapter` | `rollReference()` | Bypass the 24h delay + re-agreement check | **[F-3]** |
| Chainlink (feed operator / protocol) | feed deprecation | Permanent DoS, no on-chain replacement path | **[F-6]** |
| Any address (omission) | withholding `record()` | Availability-only DoS | **[F-7]** |
| Owner (single key) | all 4 reference-mgmt functions | Centralized single point of failure | **[F-8]** |
| Uniswap V4 PoolManager (assumed honest) | `extsload` at hardcoded slots | Silent misread if layout ever differs (verified correct today) | **[F-13]**, addressed |
| Chainlink feed (flash-crash) | `latestRoundData` | Mispricing below aggregator floor | **[F-11]** |
| Unknown downstream consumer | any quote fn | Directional/rounding misuse | invariant holds — each function's own rounding direction is internally correct (see [F-9]/[F-12] for the two residual precision nuances) |

---

## Findings

### [F-1] Permissionless checkpoint-weighting lets an attacker force the fail-closed staleness gate to *pass* on a stale/manipulated reference price
**Severity**: High · **Confidence**: 80 · **Origin**: `[phase1: oracles, defi-amm]` + `[phase2:
economic-security, trust-gap]` — independently raised by 4 agents across both phases; this is the most severe
articulation, elevated from the phase-1 framing.
**Location**: `AzlEthTwapAdapter.azlPerEth()` L147-156, `_validateLivePool()` L182-193; fed by
`AzlV4ObservationOracle.record()` L116-141 / `consult()` L143-167

**Description**: `record()` (permissionless) accumulates `previous.tickCumulative + int56(previous.tick) *
int56(uint56(elapsed))` (L138) — it weights the tick from the *previous* checkpoint over the entire interval
until the *current* call, not the tick actually held during that interval. Since `elapsed` can be as large as
`maxObservationGap` (constrained to ≤ `twapWindow`/4 at construction, L92-95 of the oracle), a single checkpoint
can carry up to 25% of the TWAP window's weight. Anyone can choose *when* to call `record()`, and immediately
before calling it can move the pool's spot tick (swap in, `record()`, swap back — all in one transaction).

`azlPerEth()` (L147-156) is designed to revert (`NotReady`) when the live TWAP disagrees with the stored
`referenceTick` by more than `MAX_REFERENCE_TICK_DEVIATION` (487 ticks, ~5%, checked at L152) — this is the
oracle's core "fail closed when the reference goes stale" guarantee, and it fires with **no owner action
required**. But because the `meanTick` that decides pass/revert comes from the same manipulable `consult()`,
an attacker can use the checkpoint-weighting technique above to drag the TWAP back within 487 ticks of an
already-stale `referenceTick`, even while the *true* market has moved much further — causing `azlPerEth()` to
keep returning the old, now-wrong price to any downstream consumer instead of correctly failing closed.

**Proof of Concept**: Active reference was set when true AZL/ETH was at tick R. True market moves 15% away from
R (ordinary volatility for a low-cap token) — honestly, `azlPerEth()` should revert since `|meanTick − R| > 487`.
Attacker instead, once per `maxObservationGap` window (repeated ~3-4 times across one `twapWindow`, e.g. every
~7-8 min for a 30-min window at the tightest allowed gap): swaps the pool tick toward R, calls `record()`
(checkpointing the pushed tick, weighted up to 25% of the window), lets the pool arbitrage back. After ~3-4
such atomic actions the weighted mean can be pulled back within 487 ticks of R even though true price sits far
outside that band. `azlPerEth()` then passes both `_validateLivePool`'s spot-vs-mean gate (953 ticks, ~10%,
since spot is restored between actions) and the 487-tick reference-agreement gate, and returns the stale,
incorrect price. Cost is bounded to round-trip swap fees/slippage across a handful of atomic actions — not
principal at risk — for control over what price is served to every downstream consumer.
**Recommendation**: Do not let the same manipulable pool serve as both the priced value and its own validator.
Cap per-checkpoint TWAP weight well below 25% of the window (tighten the `maxObservationGap`:`twapWindow` ratio,
require a minimum checkpoint-density floor, or use a trimmed-mean/median over checkpoints instead of pure
interval-time-weighting). Consider an independent cross-check (a second venue, or bounding drift against the
Chainlink-derived USD price already available in `AzlUsdOracle`) before trusting "fresh TWAP agrees with
reference" to mean the reference is actually still valid.

### [F-2] Single-block spot/liquidity displacement can selectively deny a targeted liquidation
**Severity**: Medium · **Confidence**: 70 · **Origin**: `[phase2: economic-security]`; related mechanism to
[F-7] (distinct: active/targeted single-block denial vs. passive/withholding availability decay)
**Location**: `AzlEthTwapAdapter._validateLivePool()` L182-193

**Description**: `_validateLivePool` reverts if `activeLiquidity() < minimumActiveLiquidity` (L190) or
`|spotTick − meanTick| > MAX_SPOT_TWAP_TICK_DEVIATION` (953 ticks, ~10%, L191). Both are single-block,
instantaneous-spot conditions that a swap can trigger and reverse within one block. An attacker who can see a
pending, oracle-dependent liquidation transaction (e.g. one that reads `AzlUsdOracle.isValid()`/quote functions
to value AZL collateral) can front-run it with a displacing swap, causing `_validateLivePool` to revert for
that block, then back-run to restore the pool — denying that specific liquidation window at the cost of only
round-trip swap fees. This benefits an underwater position holder evading their own liquidation.
**Proof of Concept**: LEAD-grade trace (requires a downstream liquidation consumer, out of this scope's direct
control, but explicitly the kind of consumer this stack's own NatSpec is written for): front-run to push spot
beyond the 953-tick band or into a thin-liquidity tick range, causing `azlPerEth()`/`isValid()` to revert for
the victim's transaction; back-run to restore.
**Recommendation**: Require displacement to persist across multiple blocks before failing closed, rather than
reacting to single-block spot/liquidity snapshots; or gate liquidation-critical reads on the TWAP path alone.

### [F-3] `rollReference()` bypasses the 24h delay and stale-proposal re-agreement check
**Severity**: Medium · **Confidence**: 90 · **Origin**: `[phase1: access-control, oracles]` + `[phase2: all
12 agents flagged this as a lead/finding — the single most-converged item in the entire audit]`
**Location**: `AzlEthTwapAdapter.rollReference()` L158-165

**Description**: The intended reference-update path is two-transaction and delayed: `proposeReference()` stages
a tick behind a mandatory 24h timer (L110-116); `activateReference()` only promotes it if a *fresh* TWAP still
agrees within 487 ticks (~5%, L119-135). `rollReference()` (owner-only) collapses this to one transaction — one
`consult()`, one `_validateLivePool()`, then `referenceTick = meanTick` immediately (L158-165) — with no delay,
no prior public-staging window, and no bound relative to the *previous* reference (only the live-pool ~10%
spot-vs-TWAP gate). This removes both the 24h public-visibility window and the independent second confirmation
for the same state variable the delayed path protects. The write is still bounded to a `_validateLivePool`-gated
`consult()` value (never an arbitrary tick), so this is a trust-model weakening, not a direct-drain bug — but
combined with [F-1]'s TWAP-manipulation capability, a manipulated-but-in-gate value can be locked in for up to
7 days (`REFERENCE_MAX_AGE`) in a single transaction.
**Proof of Concept**: Owner-key compromise, or an honest owner acting on a manipulated live pool (owner
transactions are public in the mempool before inclusion) → `rollReference()` snaps `referenceTick` to a value
bounded only by the ~10% spot-vs-TWAP gate, with no 24h window in which the change would need to persist and
re-pass a second check.
**Recommendation**: Subject `rollReference()` to the same delay as propose/activate, or bound it against the
*current* `referenceTick` (not just a self-consistent fresh TWAP) so one transaction can't move the reference by
the full gate allowance. Place the owner behind a timelock/multisig (see [F-8]).

### [F-4] `rollReference()` doesn't clear a pending proposal — a stale proposal can later overwrite a freshly-rolled reference
**Severity**: Low · **Confidence**: 85 · **Origin**: `[phase1: general]` + `[phase2: 6 of 12 agents —
asymmetry, execution-trace, invariant, flow-gap, trust-gap, access-control-adjacent]`
**Location**: `AzlEthTwapAdapter.rollReference()` L158-165, interacting with `activateReference()` L119-135

**Description**: `rollReference()` writes `referenceTick`/`referenceActivatedAt` but never touches
`pendingReferenceTick`/`pendingReferenceValidAfter` — unlike `activateReference()` (L132-133) and
`cancelReferenceProposal()` (L139-140), which both explicitly `delete` them. If the owner proposes at T0, then
rolls at T1, the T0 proposal remains activatable in `[T0+24h, T0+24h+3d]`, silently reverting the freshly-rolled
reference to the older staged value if `activateReference()` is later called (e.g. by an operator/multisig
queue believing it a no-op). Still gated by `_validateLivePool` + the 487-tick agreement check at activation
time, so it cannot inject an arbitrary price — a state-hygiene/asymmetry bug, not a fund-loss bug on its own.
**Recommendation**: In `rollReference()`, also `delete pendingReferenceTick; delete
pendingReferenceValidAfter;` so no dangling proposal survives a roll.

### [F-5] Fail-closed dependency on permissionless keepers — cheap availability griefing
**Severity**: Low · **Confidence**: 65 · **Origin**: `[phase1: defi-amm]`
**Location**: `AzlV4ObservationOracle.consult()` L143-167; `AzlEthTwapAdapter.azlPerEth()`;
`AzlUsdOracle._tryTwap()` L169-180

**Description**: If nobody calls `record()` for `maxObservationGap`, the next call resets the epoch
(`epochStartIndex = length`, L131), and the whole stack reverts `NotReady`/returns `isValid()==false` for at
least a full `twapWindow` (≥30 min) afterward while checkpoints re-accrue. Availability-only (fail-closed, no
wrong price); distinct from [F-1]/[F-2], which manipulate content/state rather than withhold entirely.
**Recommendation**: Consider incentivizing `record()` calls, or document the expected downtime and ensure
downstream consumers handle `isValid()==false` gracefully.

### [F-6] Immutable Chainlink ETH/USD feed has no on-chain replacement path — permanent DoS if the feed is deprecated
**Severity**: Medium · **Confidence**: 60 · **Origin**: `[phase1: oracles]`
**Location**: `AzlUsdOracle` constructor / `ethUsdFeed`, `sequencerUptimeFeed` — L81-101

**Description**: Both feeds are `immutable` and `AzlUsdOracle` has no owner/admin at all. Chainlink periodically
deprecates/migrates aggregators. try/catch fails closed (no mispricing on deprecation) but permanently bricks
`isValid()`/every quote function with no on-chain path to point at a replacement — full redeploy + downstream
migration required.
**Recommendation**: Either add a minimal timelocked admin able to swap the feed addresses, or explicitly
document feed deprecation as an accepted redeploy event.

### [F-7] No `minAnswer`/`maxAnswer` circuit-breaker check on the Chainlink ETH/USD feed
**Severity**: Low · **Confidence**: 55 · **Origin**: `[phase1: oracles]`
**Location**: `AzlUsdOracle._tryEthUsdWad()` L182-225

**Description**: Validation checks positivity/staleness/round-ordering/decimals but never checks the
aggregator's `minAnswer`/`maxAnswer` bounds. In a flash-crash below the aggregator floor, Chainlink reports
`minAnswer` (above the true price) and all current checks still pass — an inflated `ethUsdWad` understates
required AZL collateral in USD terms, the non-conservative direction during exactly the tail event the haircut
is meant to guard against.
**Recommendation**: Read and enforce `minAnswer()`/`maxAnswer()` from the underlying aggregator.

### [F-8] Single-owner control of the reference, no on-chain timelock/multisig requirement
**Severity**: Low · **Confidence**: 70 · **Origin**: `[phase1: access-control]`
**Location**: `AzlEthTwapAdapter` owner role, set at `V2Ownable2Step(initialOwner)` L85-87

**Description**: All four reference-mutating entrypoints are `onlyOwner`, and the owner is a single address with
no on-chain requirement that it be a multisig/timelock. Bounded blast radius (owner can never write an arbitrary
tick, only a gated `consult()` value) but a single point of failure, compounded by [F-3]/[F-1]. Positive
controls verified correct: two-step transfer, hard-disabled `renounceOwnership()`, correct
`cancelOwnershipTransfer()`, OZ `Ownable` constructor reverts on zero `initialOwner`.
**Recommendation**: Require `initialOwner` to be a timelocked multisig; verify the deployed owner of
`0xf9CD...5040` before relying on the delayed-reference safety story.

### [F-9] Delayed reference + strict ±5% live-agreement gate bricks the oracle during legitimate volatility
**Severity**: Low · **Confidence**: 55 · **Origin**: `[phase1: oracles]`
**Location**: `AzlEthTwapAdapter.azlPerEth()` L147-156

**Description**: Any genuine AZL/ETH move beyond ~5% (ordinary for a low-cap token) takes the entire
`AzlUsdOracle` offline until the owner re-proposes (24h delay) or calls `rollReference` ([F-3]). Fail-closed
(safe direction) but the DoS window coincides with exactly the volatility events consumers most need a price.
**Recommendation**: Consider a wider/asymmetric band, a faster emergency re-activation path, or a bounded
auto-follow mechanism.

### [F-10] No emergency pause / circuit-breaker for the oracle stack
**Severity**: Low · **Confidence**: 55 · **Origin**: `[phase1: access-control]`
**Location**: whole stack — no `Pausable`/`paused` state anywhere

**Description**: If the owner learns off-chain that the pinned pool/hook is compromised in a way that still
keeps `_validateLivePool` passing, there is no owner-callable action to force `isReady()`/`isValid()` false.
Low because the stack holds no funds and correct downstream consumers are expected to independently gate on
`isValid()`/`isReady()`.
**Recommendation**: Add an owner-only one-way pause that can only halt price emission (never emit a price).

### [F-11] `quoteUsdForAzl` applies the haircut after truncating to USD6 — avoidable ≤1-unit precision loss
**Severity**: Low · **Confidence**: 60 · **Origin**: `[phase1: precision-math]`
**Location**: `AzlUsdOracle.quoteUsdForAzl()` L142-149

**Description**: Three sequential floor divisions truncate to USD6 before applying the final ×0.8 haircut
multiply, instead of fusing the haircut into the final scale-down (as `quoteAzlForUsd` already does via
`_mulDiv3RoundingUp`). Loses up to 1 USD6 unit versus the ideal fused computation; direction is conservative
(understates further), so this is a latent precision loss, not a value leak.
**Recommendation**: Fuse as `mulDiv(usdValueWad, USD6*(BPS-HAIRCUT_BPS), WAD*BPS)` in one floor division.

### [F-12] `_quoteAtTick` rounds `azlPerEth` up in both branches — wrong direction for `quoteUsdForAzlPar`'s "never understate" invariant
**Severity**: Low · **Confidence**: 50 · **Origin**: `[phase1: precision-math]` + `[phase2: math-precision,
numerical-gap — independently converged]`
**Location**: `AzlEthTwapAdapter._quoteAtTick()` L209-218; consumed at `AzlUsdOracle.quoteUsdForAzlPar()`
L134-139

**Description**: `_quoteAtTick` always rounds up, making `azlPerEth()` systematically ≥ the true tick-implied
price by ≤~2 wei. Protocol-favoring in `quoteAzlForUsd`/`quoteUsdForAzl` (correct direction in both), but
`quoteUsdForAzlPar` divides by `azlPerEth`, so the over-estimate biases the par value *downward* — the one
direction its "never understate a liability cap" invariant forbids. Bounded by
`usdValueWad·(2 wei/azlPerEth)`, far below one USD6 unit for any realistic AZL price/position size — no
practically-triggerable impact found by either phase's agents.
**Recommendation**: Document that par's own upward rounding dominates the ≤2-wei input bias, or expose a
round-down variant of `_quoteAtTick` for denominator use if strict correctness is desired.

### [F-13] Hardcoded V4 `extsload` storage-layout constants — verified correct; `record()` doesn't validate its own read
**Severity**: Info · **Confidence**: 60 · **Origin**: `[phase1: general, defi-amm]` + `[phase2: boundary,
periphery]`
**Location**: `AzlV4ObservationOracle._slot0()`/`POOLS_SLOT` L54, 187-192; `AzlEthTwapAdapter._slot0()`/
`activeLiquidity()`/`LIQUIDITY_OFFSET` L68-69, 167-171, 202-207; unused `IV4PoolManager.getSlot0`

**Description**: Four independent domain/attack agents across both phases confirmed `POOLS_SLOT=6` and
`LIQUIDITY_OFFSET=3` match canonical Uniswap V4 `StateLibrary` (the periphery agent additionally recomputed
`V4PoolKey.toId()` and confirmed it equals the hardcoded pool id) — **this is not a live bug**. The residual,
informational risk: `AzlEthTwapAdapter._validateLivePool` validates the decoded slot0 word (tick
self-consistency, nonzero check) before use, but `AzlV4ObservationOracle.record()` performs no equivalent check
on the same kind of read before checkpointing — an asymmetry between the two contracts reading identical data.
Not reachable for an always-initialized real V4 pool; no concrete trigger found by any of the 12 Phase-2
agents.
**Recommendation**: Add the same `sqrtPriceX96 != 0` / tick self-consistency check to `record()`'s `_slot0()`
read. Remove the unused `getSlot0` declaration to avoid implying an alternate safe path exists.

### [F-14] `AzlEthTwapAdapter` has no independent L2-sequencer-uptime gate of its own
**Severity**: Info · **Confidence**: 50 · **Origin**: `[phase2: first-principles]`
**Location**: `AzlEthTwapAdapter.azlPerEth()`/`isReady()` — whole contract

**Description**: Within this job's three-contract scope this is masked, since `AzlUsdOracle` always ANDs the
adapter's result with `_tryEthUsdWad()` (which carries the sequencer-uptime gate). If any consumer outside this
scope reads `AzlEthTwapAdapter` directly, it would accept frozen/stale pool state during a Base sequencer
outage with no gate of its own. Unverified whether such a direct consumer exists.
**Recommendation**: Document that the adapter must only be consumed through a sequencer-gating wrapper, or add
the check directly.

### [F-15] Chainlink price-scaling overflow guard protects only the scale multiply, not downstream products
**Severity**: Info · **Confidence**: 50 · **Origin**: `[phase1: precision-math]` + `[phase2: math-precision]`
**Location**: `AzlUsdOracle._tryEthUsdWad()` L217-220 and `quoteAzlForUsd()` L120

**Description**: The overflow guard covers `priceWad = unsignedAnswer*scale` but applies no upper plausibility
bound on the resulting `ethUsdWad`. `quoteAzlForUsd`'s `ethUsdWad*(BPS-HAIRCUT_BPS)` (checked arithmetic) could
theoretically overflow-revert if a malfunctioning 18-decimal feed reported an astronomically large answer
(~1.4e73+) — DoS'ing that quote path. Requires a trusted feed to malfunction at a magnitude no real Chainlink
feed can produce; non-exploitable in practice.
**Recommendation**: Add min/max sanity bounds on `ethUsdWad` in `_tryEthUsdWad` (overlaps [F-7]'s remediation).

---

## Rejected

**"`activateReference()` stores the stale staged `proposedTick` rather than the freshly-validated
`meanTick`"** (raised as a FINDING by a Phase-2 attack agent) — verified against source
(`AzlEthTwapAdapter.sol:130`: `referenceTick = proposedTick;`, confirmed by direct `sed` read) — the factual
claim is correct, but this is **intentional design, not a bug**. Storing the old, publicly-staged value (rather
than a value only ever checked once, at the activation instant) is exactly what makes the 24h delay meaningful:
it is what was exposed to 24h of public observability, during which `cancelReferenceProposal()` could be called
if a manipulated proposal were spotted. The fresh `meanTick` re-check at activation exists only to confirm the
market hasn't materially diverged since staging — not to select which value becomes canonical. Storing the
fresh value instead would mean the actually-persisted reference is whatever the TWAP happens to be in the exact
activation block, with *zero* prior public scrutiny of that specific value — the opposite of the intended
model, and inconsistent with the contract's own NatSpec ("the returned valuation is economically independent
of the current execution price"). No attack was demonstrated that depends on this detail beyond the
already-captured [F-1]/[F-3] TWAP-manipulation capability.

---

## Leads (not promoted to findings)

- Checked (non-`unchecked`) `int56` accumulator in `record()` could theoretically revert-brick under a
  pathological constructor config (`twapWindow` near `2^32`) — implausible precondition (governance
  misconfiguration at deploy time), not promoted.
- 1-tick floor-rounding in `consult()` can technically let a TWAP marginally (~0.01%) beyond the 487/953
  deviation bounds pass the gate — magnitude far below materiality.
- `_validateLivePool`'s `{spotTick, spotTick+1}` tolerance: one Phase-2 agent speculated the reverse
  (`spotTick-1`) could occur and cause a persistent DoS; another Phase-2 agent independently reasoned through
  V4's up-swap/down-swap-boundary tick-storage semantics and concluded the current direction is correct and
  matches both legitimate V4 cases. Neither had Uniswap V4 core `Pool.sol` in-scope to fully confirm. **Open
  question** — recommend a manual check against the actual V4 core source before considering this closed.

## Coverage Gate

- **Entrypoints**: 8 external/public state-changing functions in source, 8 examined across both phases
  (`record`, `proposeReference`, `activateReference`, `cancelReferenceProposal`, `rollReference`,
  `transferOwnership`, `acceptOwnership`, `cancelOwnershipTransfer`). `AzlUsdOracle` has zero state-changing
  functions, confirmed by both phases independently.
- **Threat-catalog rows**: 8 rows in the Phase-0 catalog (see Threat Model table above), all 8 answered — 6 by
  a specific finding, 2 by "invariant holds" with the reasoning inline.
- **Holes closed this pass**: 0. Both phases independently examined every entrypoint and every catalog row;
  Phase 2 additionally re-verified the V4 storage-slot constants (`POOLS_SLOT=6`, `LIQUIDITY_OFFSET=3`) by
  independent computation against canonical Uniswap V4 `StateLibrary`, and recomputed `V4PoolKey.toId()` against
  the hardcoded pool id — both confirmed correct.

---

## Open Questions (carried from Phase 0, unresolved)

1. Does the hardcoded `POOLS_SLOT=6`/`LIQUIDITY_OFFSET=3` assumption match the actual deployed Base
   PoolManager storage layout? — **Resolved in this audit**: independently verified correct by two Phase-2
   agents against canonical Uniswap V4 `StateLibrary`.
2. How reliably do permissionless keepers actually call `record()` in practice? — Operational, not
   source-verifiable; see [F-5].
3. `_validateLivePool`'s asymmetric `{spotTick, spotTick+1}` tolerance — see Leads above; recommend manual
   verification against Uniswap V4 core `Pool.sol` swap semantics (not in this audit's scope).
4. Is the deployed owner of `AzlEthTwapAdapter` (`0xf9CD...5040`) a multisig/timelock, or an EOA? Not
   verifiable from source — see [F-8].

---

> This review was performed by an AI-orchestrated multi-agent audit pipeline (protocol-mapping phase +
> checklist-breadth phase + attacker-mindset depth phase, reconciled). AI analysis can never verify the
> complete absence of vulnerabilities and no guarantee of security is given. Independent human review, a bug
> bounty program, and on-chain monitoring are strongly recommended before this stack is relied upon for
> significant value.

////

# 🔐 Security Review — Azzle V2 Collateral/Pricing Subsystem (Job 551)

---

## Audit Target

| | |
|---|---|
| **Chain** | Base mainnet (chain 8453) |
| **Source** | Sourcify exact-match (compiler `0.8.24+commit.e11b9ed9`) |
| **Contracts** | `AzlUsdOracle` @ `0xDc3bffd0E0B1325F227567fc3514C18d69057993`<br>`AzlPricingPolicy` @ `0xd19E9A25d138d6D9A1d0E4CEe81075051AEF5813`<br>`AgentDepositVaultV2` @ `0x1A7eD8154dbc0a4914cf8D2181A5d5441fdDaca6` |
| **Files reviewed** | `AzlUsdOracle.sol` · `AzlPricingPolicy.sol`<br>`AgentDepositVaultV2.sol` · `access/V2Ownable2Step.sol` |
| **Scope** | 693 LOC in-scope (excl. interfaces/vendored libs) |
| **Methodology** | Phase 0 (context map, opus) → Phase 1 (7 ethskills domain agents, opus) → Phase 2 (12 pashov attack agents, opus, blind to Phase 1) → hybrid reconciliation |

**Scope note**: this job's description was truncated on-chain (a hard byte-limit cut the submitted JSON mid-object, and `messages.sh` returned no clarification). Scope was reconstructed from the three named addresses (`usdOracle`, `pricingPolicy`, `depositVault`) and confirmed via on-chain bytecode presence and Sourcify verification — see `TARGET.md` in the audit working directory for detail. Two related addresses (`observationOracle`, `twapAdapter`) referenced in an adjacent job's truncated description are the AZL/ETH TWAP source consumed by `AzlUsdOracle` here; they are **out of scope for this engagement** and are treated as a black box per their declared interface, consistent with `AzlUsdOracle`'s own NatSpec accepted-risk framing.

---

## Reconciliation Summary

**Overlap**: 8 findings independently confirmed by both Phase 1 (ethskills) and Phase 2 (pashov, blind) · **Phase-1-only**: 8 · **Phase-2-only** (new, surfaced only by blind attack agents): 2 · **Re-examined leads kept**: 2, demoted: 0 · **Coverage holes closed this pass**: 0 (all 12 entrypoints and all 15 threat-catalog rows were already addressed by the two hunting phases).

Notably, **8 of 12 Phase-2 attack agents — running blind to each other and to Phase 1 — independently converged on the same defect** (`debitExitFee()` missing a `harmed != account` guard present in its sibling and its own advisory pre-check). No agent in either phase found a Critical or High severity issue; both phases independently concluded the core deposit/reservation/solvency accounting (invariants I1–I6) is sound under adversarial tracing.

**Confidence floor**: findings below confidence 50 are demoted to a Leads note rather than reported as findings. All 19 findings below cleared that bar; no items required demotion.

---

## Findings

**Severity tally**: 0 Critical · 0 High · 4 Medium · 12 Low · 3 Info

[85] **1. `debitExitFee()` omits the `harmed != account` check present in its own advisory pre-check and its sibling function**

`AgentDepositVaultV2.debitExitFee` · Severity: **Medium** · Confidence: 85 · Origin: **[both]** — flagged independently by 10 agents total: Phase 1 `General-1`, `AccessControl-1`; Phase 2 `math-precision`(adjacent), `access-control`, `economic-security`, `execution-trace`, `invariant`, `asymmetry`, `trust-gap`, `first-principles`, `flow-gap`

**Description**: `canResolveTask()` (view, line 217) requires `harmed != defaulter`. The sibling state-changing function `debitAccessFeeTo()` (lines 260-264) requires `recipient != account`. But `debitExitFee()` (lines 222-226) requires only `harmed != address(0)` — never `harmed != account`. If `registry` ever calls `debitExitFee(taskId, account, harmed=account)`, the defaulter's full `fee = exitCompensation + exitProtocolShare` is debited from their deposits (line 226 check, deducted via lines 232-233), but `_payOrDefer(harmed, reservation.exitCompensation)` at line 235 pays that exact `exitCompensation` back to the defaulter (`harmed == account`). Net effect: the intended default penalty collapses from `exitCompensation + exitProtocolShare` to just `exitProtocolShare` — the harmed-party compensation mechanism is defeated for that call.

**Proof**: Trace with `exitCompensation=X, exitProtocolShare=Y`, `deposits[account]=D`: pre-call `D`. Line 232: `deposits[account] = D - (X+Y)`. Line 235: `_payOrDefer(account, X)` transfers `X` AZL back to `account`'s external wallet. Net on-chain balance change for `account`: `-(X+Y)` in the vault, `+X` in their wallet — i.e. the "penalty" that reaches anyone else is only `Y`. This is a concrete, mechanical state trace, not speculation — the only precondition is `registry` supplying `harmed==account`, which the codebase's own `canResolveTask()` view treats as invalid.

**Fix**

```diff
     function debitExitFee(uint256 taskId, address account, address harmed) external onlyRegistry nonReentrant {
         TaskReservation memory reservation = taskReservations[taskId][account];
         uint256 fee = reservation.exitCompensation + reservation.exitProtocolShare;
-        require(harmed != address(0) && reservation.amount > 0 && fee > 0, "ADv2: exit");
+        require(harmed != address(0) && harmed != account && reservation.amount > 0 && fee > 0, "ADv2: exit");
         require(fee <= reservation.amount && deposits[account] >= fee, "ADv2: exit funds");
```

---

[90] **2. `treasury.recordRevenue()` has no try/catch; treasury is immutable — a reverting treasury permanently bricks `debitExitFee()` and fee-charging `reserveTask()`**

`AgentDepositVaultV2.reserveTask` / `debitExitFee` / `claimPayout` · Severity: **Medium** · Confidence: 90 · Origin: **[both]** — Phase 1 `General-2`/`DoS-1`/`Oracle-1`(partial); Phase 2 `economic-security`, `boundary`, `periphery`, `invariant`, `first-principles`, `flow-gap`, `trust-gap`(adjacent) — 9 total corroborations, the single most-repeated liveness concern across both phases

**Description**: `treasury` is set exactly once in one-shot `configure()` (line 106: `require(gateway == address(0))` blocks any second call) with **no setter to ever change it**. `ITreasuryRevenueV2(treasury).recordRevenue(...)` is called with no try/catch at three sites: `reserveTask()` line 193, `debitExitFee()` line 240, `claimPayout()` line 285. A revert inside `recordRevenue` reverts the entire enclosing transaction. Worst case is `debitExitFee()`: `exitProtocolShare` is always `>0` for a valid quote (policy constants `EXIT_PROTOCOL_SHARE_USD6 = 2_500_000`, `AzlPricingPolicy.sol:51`) and a standard-ERC20 transfer to `treasury` always succeeds, so `recordRevenue` fires on **every** exit-fee resolution — if it reverts, exit-fee resolution (and therefore default resolution for that task) is permanently and unrecoverably blocked. `reserveTask()`'s exposure is narrower (registry can route around via `waiveAccessFee=true`, line 180). `claimPayout()`'s exposure is self-limited to treasury's own claim.

**Fix**

```diff
-            if (_payOrDefer(treasury, reservation.exitProtocolShare)) {
-                ITreasuryRevenueV2(treasury).recordRevenue(reservation.exitProtocolShare);
+            if (_payOrDefer(treasury, reservation.exitProtocolShare)) {
+                try ITreasuryRevenueV2(treasury).recordRevenue(reservation.exitProtocolShare) {} catch {}
             }
```
(apply the same pattern at lines 193 and 285; alternatively/additionally add an owner-gated, ideally timelocked, setter to rotate `treasury`.)

---

[80] **3. `ethUsdFeed`/`sequencerUptimeFeed`/`azlEthTwap`/`maxFeedAge` are immutable with no governance update path — a feed deprecation or heartbeat change permanently bricks new task creation**

`AzlUsdOracle` constructor (lines 87-101) → consumed at `AgentDepositVaultV2.reserveTask()` line 163 · Severity: **Medium** · Confidence: 80 · Origin: **[phase1-only]** (Oracle-1)

**Description**: All oracle-feed addresses and `maxFeedAge` are `immutable`; `AzlPricingPolicy.oracle` and `AgentDepositVaultV2.policy` are themselves `immutable`. There is no in-place mechanism to point at a replacement feed or re-tune staleness after deployment. Both `_tryTwap()` and `_tryEthUsdWad()` fail closed (return `(false,0)` → `_validatedPrices()` reverts `"AzlOracle: invalid"`), so a deprecated Chainlink feed, a blocked feed, or a heartbeat lengthened past `maxFeedAge` permanently reverts every `createQuote=true` `reserveTask()` call — new task creation for the whole marketplace — with no recovery short of redeploying and migrating the vault. Existing withdrawals/releases are unaffected (they don't touch the oracle).

**Recommendation**: Add an owner-gated (ideally timelocked) setter for the feed addresses and `maxFeedAge`, or make the oracle address itself swappable in the policy/vault.

---

[75] **4. `_safeTransferExact`'s exact-balance-delta enforcement permanently locks `withdraw`/`claimPayout`/`rescueSurplus` if AZL is ever fee-on-transfer, rebasing, paused, or blacklists the vault**

`AgentDepositVaultV2._safeTransferExact` (lines 338-344), reached by `withdraw` (145), `claimPayout` (284), `rescueSurplus` (294) · Severity: **Medium** · Confidence: 75 · Origin: **[phase1-only]** (ERC20-2)

**Description**: Requires `beforeBalance - balanceOf(this) == amount && balanceOf(recipient) - recipientBefore == amount` (lines 342-343) — correct defensive design for a genuinely standard token, but any deviation (fee-on-transfer, rebase, pause, vault-address blacklist) makes every user-facing exit path revert permanently. The `azl` token address is `immutable` and validated only by `code.length != 0` (line 99) — nothing pins its *behavior*, only its address. If AZL is itself an upgradeable/proxy token whose behavior changes post-deploy (address stays constant), or if the wrong token is deployed against, every depositor's funds lock simultaneously. Fails closed (no accounting corruption), but the residual is total, permanent fund lock for all depositors — not a graceful degradation.

**Recommendation**: Treat AZL as non-upgradeable/standard as a hard, audited deployment precondition — document explicitly. Consider a governance-gated measured-delta fallback path if survivability of a token-behavior change is required.

---

[80] **5. Registry-supplied `recipient`/`harmed == address(this)` (the vault) permanently strands funds as unclaimable `pendingPayouts`**

`AgentDepositVaultV2.debitExitFee` (line 235), `debitAccessFeeTo` (line 271), via `_payOrDefer` (lines 318-335) · Severity: **Low** · Confidence: 80 · Origin: **[both]** — Phase 1 `General-4`; Phase 2 `flow-gap` (independently, different lens)

**Description**: If `recipient`/`harmed == address(this)`, `_payOrDefer`'s self-transfer produces a zero balance delta on both sides → the deferral branch's `require(afterBalance==beforeBalance && recipientAfter==recipientBefore)` (line 328) passes → credits `pendingPayouts[address(this)] += amount` (line 329). No caller can ever satisfy `msg.sender == address(this)` in `claimPayout()`, so the amount is permanently unclaimable — it inflates `liabilities()` forever, correspondingly shrinking what `rescueSurplus()` can ever recover.

**Fix**

```diff
     function debitExitFee(uint256 taskId, address account, address harmed) external onlyRegistry nonReentrant {
         ...
-        require(harmed != address(0) && harmed != account && reservation.amount > 0 && fee > 0, "ADv2: exit");
+        require(harmed != address(0) && harmed != account && harmed != address(this) && reservation.amount > 0 && fee > 0, "ADv2: exit");
```
(apply the analogous `recipient != address(this)` check to `debitAccessFeeTo`, line 260-264.)

---

[70] **6. Deferred payout to `harmed`/`recipient == treasury` is mis-recorded as protocol revenue**

`AgentDepositVaultV2.debitExitFee` (line 235) / `claimPayout` (line 285) · Severity: **Low** · Confidence: 70 · Origin: **[phase2-only]**, surfaced independently by 7 agents (`access-control`, `boundary`, `execution-trace`, `invariant`, `asymmetry`, `trust-gap`, `first-principles`)

**Description**: `debitExitFee`'s `_payOrDefer(harmed, reservation.exitCompensation)` (line 235) never calls `recordRevenue` on immediate success — correct, since compensation to a harmed worker isn't protocol revenue. But if that transfer *defers* (e.g. `harmed == treasury` and the transfer fails for any reason), the amount lands in `pendingPayouts[treasury]`, and `claimPayout`'s treasury branch (line 285) later calls `recordRevenue(amount)` on the **entire** pending balance — silently reclassifying harmed-party compensation as revenue. Same root cause class as Finding 1/5 (`harmed` unvalidated against system addresses); extend the same guard to forbid `harmed == treasury`.

**Recommendation**: Add `harmed != treasury` to the same guard proposed in Finding 1, or track compensation vs. revenue in separate pending buckets.

---

[60] **7. `azlEthTwap.azlPerEth()` is accepted with no magnitude/deviation bound**

`AzlUsdOracle._tryTwap()` (lines 169-180) · Severity: **Low** · Confidence: 60 · Origin: **[both]** — Phase 1 `Oracle-3`/`General-3`; Phase 2 (`math-precision`, `economic-security`, `periphery`, `first-principles`, `numerical-gap` — 5 agents)

**Description**: The only validity gate is `isReady()==true` and `azlPerEth() != 0` (line 176). Any non-zero magnitude is accepted verbatim and flows linearly into every AZL↔USD conversion — the single highest-leverage value in the entire pricing stack. This is explicitly framed as an accepted risk in the oracle's own NatSpec (delegated to the out-of-scope TWAP adapter's keeper/governance diligence, job-550 scope), which is why confidence is capped at 60 rather than higher — the design intentionally places this trust outside this contract.

**Recommendation**: Consider an immutable `[min,max]` plausibility band on `azlPerEth` as defense-in-depth against a malfunctioning (not necessarily malicious) adapter, independent of whatever bounding job-550's adapter does or doesn't implement.

---

[70] **8. `AzlPricingPolicy.quoteTask()` and its five independent accessors round differently for the same oracle observation**

`AzlPricingPolicy.quoteTask()`/`_scale()` (lines 62-72, 94-96) vs. `entryDepositAzl()` etc. (lines 74-92) · Severity: **Low** · Confidence: 70 · Origin: **[both]** — Phase 1 `Precision-1`; Phase 2 (`math-precision`, `economic-security`, `periphery`, `boundary`, `first-principles`, `numerical-gap` — 6 agents, one of which empirically measured the gap)

**Description**: `quoteTask()` reads the oracle once at $1 (`azlPerUsd6 = oracle.quoteAzlForUsd(1_000_000)`, line 63) then scales each constant via `_scale` (`ceil(usd6·azlPerUsd6/1e6)`, lines 94-96) — a *double* round-up, since `quoteAzlForUsd` itself already rounds up. Each accessor calls `oracle.quoteAzlForUsd(<full constant>)` directly — a single fused round-up. Phase 2's math-precision agent empirically confirmed a gap up to `(multiplier−1)` wei per field (24 wei for the $25 entry deposit), always in the protocol-favorable direction. The in-scope vault only ever consumes the atomic `quoteTask()` path (line 163), so this is not self-inflicted DoS; the risk is an out-of-scope consumer (frontend/registry) pricing off an accessor while the vault enforces `quoteTask()`'s value.

**Recommendation**: Document the accessors as advisory-only, or make `quoteTask()` single-fuse-round like `quoteAzlForUsd` itself.

---

[55] **9. No `minAnswer`/`maxAnswer` circuit-breaker on the ETH/USD Chainlink feed**

`AzlUsdOracle._tryEthUsdWad()` (lines 204-221) · Severity: **Low** · Confidence: 55 · Origin: **[phase1-only]** (Oracle-2)

**Description**: The staleness/round-validity gate is thorough (roundId, answeredInRound, positivity, timestamp ordering, `maxFeedAge`), but never compares `answer` against the aggregator's floor/ceiling. During a flash-crash-below-floor scenario, Chainlink's aggregator reports `minAnswer` (an overstated price) rather than the true price; since `quoteAzlForUsd ∝ azlPerEth/ethUsdWad`, an overstated ETH/USD price understates required AZL collateral. Confidence is capped given the low practical likelihood for a major ETH/USD feed.

**Recommendation**: Read the underlying aggregator's bounds via `aggregator()` and reject out-of-band answers.

---

[55] **10. Sequencer-uptime feed validated only by `code.length` — a wrong or transposed address silently defeats sequencer-downtime protection**

`AzlUsdOracle` constructor (lines 87-101, check at line 98) · Severity: **Low** · Confidence: 55 · Origin: **[phase1-only]** (ChainSpecific-1)

**Description**: `require(_sequencerUptimeFeed.code.length != 0)` only confirms *a* contract exists at that address, not that it's the correct Base sequencer-uptime feed. Since the address is `immutable`, a deployer error (e.g. transposed with `_ethUsdFeed`, or a stale/wrong-chain address that happens to have code) is permanent. If the wrong contract happens to return `answer==0` with an old `startedAt`, the sequencer-downtime gate silently becomes a no-op for the life of the contract.

**Recommendation**: Constructor-time sanity check (`sequencerUptimeFeed.latestRoundData()` succeeds and returns plausible values), or pin the expected address per `block.chainid`.

---

[65] **11. No emergency pause and no path to rotate a compromised trusted role**

`AgentDepositVaultV2`, whole contract; `configure()` (lines 105-113) · Severity: **Low** · Confidence: 65 · Origin: **[phase1-only]** (AccessControl-2)

**Description**: The vault custodies all user AZL but has no pause/circuit-breaker, and `gateway`/`registry`/`arbitration`/`treasury` are permanently fixed after one-shot `configure()`. If `registry` is later compromised or buggy, owner has no on-chain lever to halt `reserveTask`/`debitExitFee`/`debitAccessFeeTo`/`credit` or repoint the role — only `rescueSurplus` (bounded, cannot preempt in-flight debits) and ownership transfer remain.

**Recommendation**: Add an owner-gated (ideally guardian/multisig) pause on privileged flows, leaving `withdraw`/`claimPayout` unpausable so users can always exit; and/or a timelocked role-rotation setter.

---

[60] **12. Immutable-address token validation (`code.length` only) doesn't pin AZL's *behavior***

`AgentDepositVaultV2` constructor (lines 98-102) · Severity: **Low** · Confidence: 60 · Origin: **[phase1-only]** (ERC20-1)

**Description**: Only `code.length != 0` is checked at deploy — no decimals/fee/rebase/hook self-test. `AzlUsdOracle` hardcodes AZL=18 decimals with no runtime check. An immutable *address* doesn't guarantee immutable *behavior* if AZL is itself upgradeable.

**Recommendation**: A post-deploy self-test (round-trip transfer + `decimals()==18` assertion), gated in `configure()`/`validateGraph()`.

---

[60] **13. `_payOrDefer`'s "silent defer" doesn't engage for partial-movement tokens — it reverts the whole call instead**

`AgentDepositVaultV2._payOrDefer()` (lines 318-335), reached by `reserveTask` (193), `debitExitFee` (235/238) · Severity: **Low** · Confidence: 60 · Origin: **[phase1-only]** (ERC20-3)

**Description**: The deferral `require` at line 328 only holds when **no** tokens moved at all. A fee-on-transfer/rebasing AZL causes partial movement, so the deferral guard itself reverts — inverting the documented "defer instead of block" intent (dev comment, line 316) into a hard revert of the entire `reserveTask`/`debitExitFee` call.

**Recommendation**: Same mitigation as Finding 4/12 — enforce token standardness as a hard precondition.

---

[55] **14. Deferred treasury payouts are permanently trapped if AZL blacklists/pauses the treasury address**

`AgentDepositVaultV2.claimPayout()` (lines 278-287) · Severity: **Low** · Confidence: 55 · Origin: **[phase1-only]** (ERC20-4)

**Description**: The treasury branch forces `recipient == treasury` (line 283) with a hard-revert `_safeTransferExact`. If AZL later blacklists/pauses the treasury address, deferred treasury fees are permanently stuck (protocol revenue, not user principal — lower severity).

**Recommendation**: Governance-gated redirect path for stuck treasury payouts.

---

[60] **15. `quoteUsdForAzl`/`quoteUsdForAzlPar` use compounding sequential rounding; sub-dust AZL amounts round to zero USD credit**

`AzlUsdOracle.quoteUsdForAzl()` (lines 142-149), `quoteUsdForAzlPar()` (lines 134-139) · Severity: **Low** · Confidence: 60 · Origin: **[phase1-only]** (Precision-2)

**Description**: Unlike `quoteAzlForUsd`'s deliberate single-fused-rounding design (`_mulDiv3RoundingUp`, lines 151-160, with an explicit comment that "intermediate rounding cannot compound"), these two functions perform 2-3 sequential floor/ceil divisions. Verified: a small-but-nonzero `azlAmount` can return `usdAmount6 == 0`. Not called by the in-scope vault (which only uses `quoteAzlForUsd`/`quoteTask`); risk is to an out-of-scope consumer.

**Recommendation**: Fold into single `FullMath.mulDiv` calls mirroring `_mulDiv3RoundingUp`.

---

[65] **16. `configure()` omits the `treasury.vault() == address(this)` link check that `validateGraph()` performs; `validateGraph()` itself is never enforced**

`AgentDepositVaultV2.configure()` (lines 105-113), `validateGraph()` (lines 115-119) · Severity: **Low** · Confidence: 65 · Origin: **[both]** — Phase 1 `General-5`; Phase 2 `access-control`

**Description**: `configure()` is one-shot and irreversible. `validateGraph()` — the only on-chain check that `treasury.vault()` correctly points back — is a `view` function nothing calls internally and no invariant enforces. A deployer can skip it entirely; a mis-wired `treasury` is then undetectable on-chain and permanent.

**Recommendation**: Fold `validateGraph()`'s checks into `configure()` itself so a broken graph reverts at wiring time.

---

[90] **17. `onlyArbitration`/`arbitration` is wired but gates zero functions**

`AgentDepositVaultV2` line 96 (modifier), line 110 (set) · Severity: **Info** · Confidence: 90 · Origin: **[both]** — Phase 1 `AccessControl-3`; Phase 2 `access-control`

**Description**: `arbitration` is a mandatory, permanently-immutable `configure()` argument, but `onlyArbitration` gates no function in scope — intentional per the dev comment at line 95 ("reserved for future arbitration-facing deposit hooks; currently unused — registry mediates exit fees"). Flagged only as dead/misleading surface: readers may assume it has enforcement power it doesn't, and it can't be repointed if a future module needs a different address.

---

[95] **18. Sequencer grace-period boundary uses `<` rather than the canonical reference's `<=`**

`AzlUsdOracle._tryEthUsdWad()` line 190 · Severity: **Info** · Confidence: 95 · Origin: **[phase1-only]** (ChainSpecific-2)

**Description**: Accepts at exactly `startedAt + SEQUENCER_GRACE_PERIOD` — one second looser than Chainlink's documented reference pattern (`> GRACE` vs. this contract's `>= GRACE`). No practical security impact given Base's ~2s block time.

---

[50] **19. Frozen `taskQuotes` (no on-chain freshness bound) plus a spot (non-averaged) ETH/USD leg give the registry a bounded timing edge on `createQuote=true` calls**

`AgentDepositVaultV2.reserveTask()` (lines 160-167), `AzlUsdOracle._tryEthUsdWad()` (lines 204-220) · Severity: **Info** · Confidence: 50 · Origin: **[phase1-only]** (Oracle-4)

**Description**: The first reserver's quote is frozen and reused verbatim by every later party with no on-chain age limit (documented design intent, NatSpec lines 150-152). The AZL/ETH leg is a smoothed TWAP but the ETH/USD leg is a spot read, giving whoever controls `createQuote=true` timing (the trusted, gated `registry`) a bounded edge straddling a pending Chainlink update. Not third-party-exploitable; included for completeness.

---

## Examined, No Issue

The following were traced adversarially by multiple Phase-2 agents and explicitly cleared — included for coverage transparency, not as findings:

- **`reserved[account] ≤ deposits[account]` (I3)** holds through every debit sequence, including concurrent multi-task interleavings — traced independently by 7 Phase-2 agents.
- **`rescueSurplus()` cannot reach reserved collateral** — `reserved ⊆ deposits ⊆ liabilities()`, so `totalReserved` being excluded from `liabilities()` is correct, not an omitted obligation. Resolves the protocol-map's open question on `totalReserved`.
- **`debitExitFee`/`debitAccessFeeTo`'s `deposits[account] >= fee` check (total, not `available()`)** could theoretically draw against collateral reserved for other concurrent tasks — traced end-to-end and proven safe: `fee <= reservation.amount` and that reservation's full amount releases in the same call, so post-state solvency is preserved.
- **Monotonic `latchedEntryFloor`** (never decreases except at zero active-reservation count, regardless of release order) — self-harm only (over-locks the account's own withdrawable balance), explicitly documented design intent.
- **No reentrancy, no unbounded loops, no delegatecall/proxy surface** — unanimous across all 12 Phase-2 agents and all 7 Phase-1 domain agents.
- **Sequencer-uptime gating polarity and grace-period direction** — correct per Chainlink's documented OP-stack pattern (aside from Finding 18's 1-second cosmetic note).

---

## Access-Control Inventory

**12/12 external/public state-changing entrypoints inventoried.**

| Function | Guard | Caller | Moves value? |
|---|---|---|---|
| `configure()` (105) | `onlyOwner` + one-shot `gateway==0` (106) | owner, once | no |
| `rescueSurplus()` (291) | `onlyOwner` + `nonReentrant` | owner | yes |
| `transferOwnership()` (OZ) | `onlyOwner` | owner | no |
| `cancelOwnershipTransfer()` (V2Ownable2Step:20) | `onlyOwner` | owner | no |
| `acceptOwnership()` (OZ) | `msg.sender==pendingOwner` | nominated owner | no |
| `renounceOwnership()` (V2Ownable2Step:16) | always reverts | nobody | no |
| `credit()` (121) | `onlyGateway` (93) + `nonReentrant` | gateway | no (accounting only) |
| `withdraw()` (141) | self-scoped + `nonReentrant` | any depositor, own funds | yes |
| `reserveTask()` (153) | `onlyRegistry` (94) + `nonReentrant` | registry | yes (conditional) |
| `releaseTask()` (198) | `onlyRegistry` | registry | no |
| `debitExitFee()` (222) | `onlyRegistry` + `nonReentrant` | registry | yes |
| `debitAccessFeeTo()` (252) | `onlyRegistry` + `nonReentrant` | registry | yes |
| `claimPayout()` (278) | self-scoped + `nonReentrant` | account w/ pending payout | yes |

`AzlUsdOracle.sol` and `AzlPricingPolicy.sol` contain no state-changing entrypoints — all functions are `view`, all configuration immutable. **Unguarded (arbitrary-caller) entrypoints**: `withdraw()` and `claimPayout()` — both strictly self-scoped to `msg.sender`'s own balance.

---

## Threat Model

**15/15 threat-catalog rows answered** (finding # or "invariant holds").

| Actor | Reach | Resolution |
|---|---|---|
| Any caller | Oracle/Policy view fns | invariant holds — view-only, no state |
| Any caller (self) | `withdraw()` | invariant holds — I3/I6 verified extensively |
| Any caller (self) | `claimPayout()` | invariant holds — I4 verified |
| Nominated owner | `acceptOwnership()` | invariant holds |
| gateway | `credit()` | invariant holds — I2 solvency check bounds; trust assumption on pre-funding (documented) |
| registry | `reserveTask()` | Finding 8 (rounding); I3 otherwise holds |
| registry | `releaseTask()` | invariant holds |
| registry | `debitExitFee()` | **Findings 1, 5, 6** |
| registry | `debitAccessFeeTo()` | Finding 5 (address(this) case) |
| owner | `configure()` | Finding 16 |
| owner | `rescueSurplus()` | invariant holds — extensively verified |
| owner | `transferOwnership`/`cancelOwnershipTransfer` | invariant holds |
| TWAP adapter (out-of-scope) | feeds `azlPerEth()` | Finding 7 |
| Chainlink feeds | feeds `latestRoundData()` | Findings 9, 10, 18 |
| treasury (out-of-scope) | `recordRevenue()`/`vault()` | **Findings 2, 3, 6** |

---

## Leads

_All findings above cleared the confidence-50 floor; nothing was demoted to a bare lead. The "Examined, No Issue" section above documents the trails that were fully resolved rather than left open._

---

> ⚠️ This review was performed by an autonomous AI audit pipeline (three-phase: context mapping → ethskills breadth → pashov-methodology depth, with cross-phase reconciliation). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Independent human review, a bug bounty program, and on-chain monitoring are strongly recommended before/alongside mainnet reliance on this subsystem.

////

# 🔐 Security Review — Azzle v2 Payment Intake (usdcWethLeg / exactInputExecutor / paymentGateway)

**Audit target (pinned):** verified on-chain source, Base mainnet (chainid 8453), retrieved via Sourcify (full match) and Basescan verified-source, as deployed at:

| Role | Address | Contract |
|---|---|---|
| `paymentGateway` | `0x0391302DE456c7E1f50244676C5C01723AEf17D0` | `AzlPaymentGateway.sol` |
| `exactInputExecutor` | `0x00DBcAfB070b7615A7F7d539faa63427DFf8d4D7` | `BaseAzlExactInputExecutor.sol` |
| `usdcWethLeg` | `0x483EfAc0E6242E230f3756D66178A71eE0Bd4B5c` | `BaseUsdcWethExactInputLeg.sol` |

Plus in-scope dependencies `access/V2Ownable2Step.sol` and `V4PoolKey.sol`. Interfaces, and vendored OpenZeppelin/Uniswap libraries are out of scope (context only). The AZL token contract and the `IAzlCreditVault` custody vault are **not provided in this job's scope** — treated as untrusted/unknown external dependencies throughout.

**Method:** Three-phase audit — Phase 0 (context: protocol map, access-control inventory, threat catalog, opus) → Phase 1 (7 domain checklists, breadth, opus) → Phase 2 (12 independent attacker-mindset agents, depth, blind to Phase 1, opus) → Phase 3 (reconciliation + coverage gate, this document). All phases run fresh for this job.

---

## Scope

| | |
|---|---|
| **Mode** | 5 files, on-chain verified source (817 LOC core scope) |
| **Files reviewed** | `access/V2Ownable2Step.sol` · `AzlPaymentGateway.sol`<br>`BaseAzlExactInputExecutor.sol` · `BaseUsdcWethExactInputLeg.sol`<br>`V4PoolKey.sol` |
| **Confidence threshold** | 50 (findings) — below 50 reported as Leads |

---

## Reconciliation Summary

`Overlap: 5 (Contract,function) tuples in both phases · Phase-1-only: 5 · Phase-2-only: 5 · Re-examined leads promoted to findings: 4 · Coverage holes closed: 0`

Phase 2 (12 blind attacker-mindset agents) returned **zero confirmed FINDINGs on its own** — every agent independently concluded the codebase is unusually hardened (balance-delta assertions bracket every token hop; a post-trade realized-price-impact check backstops the pre-trade depth math; credited AZL is always exactly the amount swapped in-transaction, never drawn from other users' balances) and downgraded its own leads accordingly. What Phase 2 *did* deliver was strong convergent corroboration: 6 of 12 independent agents flagged the same arithmetic-overflow defect, 6 flagged the same dead-code/DoS branch, 5 flagged the same stale-documentation mismatch, and 3 independently converged on a genuine architectural gap (Finding M-1 below) that no single agent could fully close because it terminates in an out-of-scope contract. Per the audit's Lead-promotion rule (multi-agent convergence, 2+ agents / full exploit chain in source), four items are promoted from Lead to Finding below; everything else remains an honest Lead.

---

## Access-Control Inventory

| Entrypoint | Guard | Caller | Value-moving |
|---|---|---|---|
| `AzlPaymentGateway.fundWithUsdc()` | `nonReentrant` + `whenIntakeOpen`, no identity guard | anyone (intake open) | yes |
| `AzlPaymentGateway.fundWithEth()` | `nonReentrant` + `whenIntakeOpen`, no identity guard | anyone (intake open) | yes |
| `AzlPaymentGateway.setIntakePaused()` | `onlyOwner` | owner | no |
| `V2Ownable2Step.cancelOwnershipTransfer()` | `onlyOwner` | owner | no |
| `V2Ownable2Step.renounceOwnership()` | always reverts | nobody | no |
| `BaseAzlExactInputExecutor.configureGateway()` | `msg.sender==configurator` + one-shot | configurator, once | no |
| `BaseAzlExactInputExecutor.executeUsdcExactInput()` | `nonReentrant` + `msg.sender==gateway` | gateway only | yes |
| `BaseAzlExactInputExecutor.executeEthExactInput()` | `nonReentrant` + `msg.sender==gateway` | gateway only | yes |
| `BaseUsdcWethExactInputLeg.executeExactInput()` | `nonReentrant`, no identity guard | anyone | yes |

**Roles:** Owner (gateway, two-step OZ `Ownable2Step`, renounce disabled) — sole power is `setIntakePaused` (pause/unpause intake; no route/token/oracle/vault control, all immutable). Configurator (executor, immutable address) — sole power is one-shot `configureGateway`, binding the executor to its gateway.

**Unguarded value-moving entrypoints (by design):** `fundWithUsdc`, `fundWithEth` (permissionless user intake, gated only by the pause flag), `BaseUsdcWethExactInputLeg.executeExactInput` (stateless, adminless swap leg — output returns to caller, no shared mutable state to poison).

---

## Threat Model

| Actor | Reaches | Could gain | Status |
|---|---|---|---|
| Arbitrary caller | `fundWithUsdc`/`fundWithEth` | Extract value via oracle/deviation manipulation | **Partially open — see M-1.** Bounded by per-tx balance-delta asserts; the deviation floor's lack of a ceiling is the residual gap. |
| MEV/searcher | Sandwich intake or the two-hop swap | Slippage beyond `minAzlOut` | Invariant holds — user's own `minAzlOut` + 25bps realized-impact floor bound this; standard MEV, not addressed further. |
| Flash-loan attacker | Move AZL/WETH V4 spot same-block, then fund | Manipulate the depth-cap/impact-cap anchor | Invariant holds — 12 independent Phase-2 agents each attempted this; the **post-trade** `_assertRealizedImpact` re-reads price after the swap and reverts on >25bps realized move regardless of the pre-trade anchor, closing this path. |
| Owner | `setIntakePaused` | Indefinite DoS | Invariant holds — no fund-theft path; centralization is by design and documented. |
| Configurator | `configureGateway` (one-shot) | Bind executor to wrong/malicious gateway | Invariant holds for third parties — configurator-only, immutable; worst case is self-inflicted deployment DoS (see L-4 Lead). |
| Malicious/hostile AZL or custody vault (both out of scope) | AZL transfers, `credit()` callback | Freeze vault holdings, DoS intake, or (per M-1) accrue par-liability credit inconsistent with payment | AZL/pause-blacklist risk and `credit()` revert-DoS: invariant holds (transient custody, atomic revert, no stuck funds). Par-liability question: **open, see M-1.** |
| Any address (read-only) | `PoolManager.extsload` via the executor | N/A | Invariant holds — layout mismatch would be caught by the tick/sqrtPrice self-consistency check for gross errors; a subtle layout match cannot be independently re-derived from source alone (author-asserted). |

---

## Findings

[65] **1. Deviation floor has no ceiling and is anchored to a discounted oracle quote, while the oracle exposes an unused par-liability quote**

`AzlPaymentGateway._guardAndCredit()` · Confidence: 65

**Description**
`_guardAndCredit` (`AzlPaymentGateway.sol:180-204`) values the AZL just purchased using `oracle.quoteUsdForAzl(amount)` (L188) — the oracle's own doc calls this the **haircut** quote — and only enforces a floor: `require(executionValue6 >= minimumValue6)` where `minimumValue6 = inputUsd6 * (BPS - maxExecutionDeviationBps)/BPS` (L189, L196). There is **no upper bound**. The `IAzlUsdOracle` interface (`interfaces/IAzlUsdOracle.sol:7-8`) separately defines `quoteUsdForAzlPar(uint256 azlAmount)`, documented as *"the par USD6 liability for AZL, rounded upward"* — this function exists in the interface but is **never called anywhere in the in-scope code** (confirmed by grep across all five files). The credit booked to the payer (`custodyVault.credit(payer, amount, creditContext)`, L202) is denominated in raw AZL token amount, not USD.

Three independent Phase-2 agents (economic-security, trust-gap, invariant), reasoning blind to each other, converged on the same mechanism: if the AZL/WETH pool trades below the oracle's *par* reference (a normal, unprivileged market condition — no attack required to reach it), a funder can be credited AZL whose *par*-denominated liability exceeds the USD they actually paid, while still clearing the haircut-based floor. The Phase-0 context map and Phase-1 oracle-domain pass (agent findings O-1/O-2) independently flagged the same "floor-only, no ceiling" and "oracle self-consistency, no cross-check to execution venue" structural gap from a different angle.

This is **not** a fully closed exploit chain: whether it converts into actual value extraction depends entirely on the out-of-scope custody vault's redemption/accounting semantics (does the vault treat 1 credited-AZL-unit as worth its *par* USD value at redemption, or does it track/reprice at the payer's actual cost basis?). Every one of the 12 blind Phase-2 agents that examined this reached the identical limitation and reported it as a Lead for that reason. The gate on "material harm to an identifiable victim" (Gate 4) cannot be closed from in-scope code alone — this is why the finding is reported at reduced confidence (65, not 80+) rather than as a High/Critical with a prescribed fix.

**Worked illustration** (from the economic-security agent, reproduced for concreteness — not independently re-verified against live pool state): if the AZL/WETH pool trades ~10% below oracle par, a ~$500 `fundWithUsdc` call (the per-tx cap) could credit AZL with a par value of ~$555 while the haircut-based floor clears trivially — the guard was never designed to catch this because it compares two quantities from the same oracle, neither of which is the par liability.

**Recommendation**
Cross-check the credited amount against `oracle.quoteUsdForAzlPar(amount)` and add a symmetric ceiling: `require(inputUsd6 * (BPS - dev)/BPS <= quoteUsdForAzlPar(amount) <= inputUsd6 * (BPS + dev)/BPS)`, or clarify (if intentional) that the vault's own accounting already reconciles this gap — in which case the unused `quoteUsdForAzlPar` function and its "par liability" doc comment should be removed to avoid the drift this audit flagged independently four times.

---

[75] **2. `_minWethForAzlOut` squares `sqrtPriceX96` in a plain `uint256` — overflow reverts the USDC funding path at extreme AZL prices**

`BaseAzlExactInputExecutor._minWethForAzlOut()` · Confidence: 75

**Description**
```solidity
// BaseAzlExactInputExecutor.sol:287
uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
```
`sqrtPriceX96` is a `uint160` that can range up to Uniswap's `TickMath.MAX_SQRT_PRICE` (~1.46e48). The product overflows `uint256` (reverting under Solidity 0.8 checked arithmetic) once `sqrtPriceX96 > 2^128`, i.e. once the raw pool price exceeds ~1.8e19 AZL per WETH. Every sibling price-squaring site in this file (`_sqrtPriceImpactFloor`, `_maxAmount0ToSqrtTarget`) correctly routes through `FullMath`'s 512-bit-safe multiplication — this is the one raw square. **6 of 12 independent Phase-2 agents** (math-precision, invariant, periphery, first-principles, boundary, numerical-gap) and 2 of 7 Phase-1 domain agents (precision-math, defi-amm) converged on this identical defect. I independently confirmed the line and logic against the live source (`sed -n '285,289p'` above).

Only `executeUsdcExactInput` calls this helper (`BaseAzlExactInputExecutor.sol:185`) — `executeEthExactInput` does not — so an overflow bricks only the USDC funding route; the ETH route is unaffected. This is a liveness/DoS defect, not a fund-loss path: `_minWethForAzlOut`'s output is only an intermediate, loose lower bound on the first swap leg — the authoritative protection is the terminal `azlReceived >= minAzlOut` check enforced independently at both the executor (`_swapWethForAzl`, L281) and the gateway (`fundWithUsdc`, L147). No agent could construct a realistic AZL price that reaches the overflow threshold for this specific pool, so reachability in the *current* market is unconfirmed — but the defect itself is unconditionally real and provable from source, which is why it is promoted from Lead to Finding here (multi-agent convergence + full arithmetic chain provable in source, per the audit's lead-promotion rule).

**Fix**
```diff
- uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
- minWethOut = FullMath.mulDivRoundingUp(minAzlOut, Q192, ratioX192);
+ minWethOut = FullMath.mulDivRoundingUp(
+     FullMath.mulDivRoundingUp(minAzlOut, Q96, sqrtPriceX96),
+     Q96,
+     sqrtPriceX96
+ );
```
This keeps every intermediate within 256 bits regardless of `sqrtPriceX96`'s magnitude, matching the `FullMath` discipline used elsewhere in the file.

---

[75] **3. `maxAdmissibleWethInput`'s zero-liquidity graceful-return is dead code — the intended "cap=0" never fires; a zero-liquidity pool state reverts and DoS's all intake instead**

`BaseAzlExactInputExecutor.maxAdmissibleWethInput()` · Confidence: 75

**Description**
```solidity
// BaseAzlExactInputExecutor.sol:226-229
function maxAdmissibleWethInput() public view returns (uint256 amountIn) {
    (uint160 sqrtPriceX96, int24 tick,) = _readPoolSnapshot();   // reverts first if liquidity == 0
    uint128 liquidity = _readLiquidity();
    if (liquidity == 0) return 0;                                 // unreachable
```
I confirmed by reading `_readPoolSnapshot()` (`BaseAzlExactInputExecutor.sol:315-334`) that it internally calls `_readLiquidity()` and executes `require(liquidity != 0, "BaseAzlExecutor: liquidity")` at line 334 — **before** `maxAdmissibleWethInput` reaches its own `liquidity == 0` check at line 229. The graceful "cap collapses to 0" branch the author clearly intended (it exists for a reason) can never execute; a zero-liquidity pool state instead reverts the whole call, which propagates into the gateway's depth-cap read (`fundWithUsdc` L135, `fundWithEth` L160) and hard-DoS's both funding entrypoints rather than cleanly returning a zero cap. 6 of 12 Phase-2 agents (access-control's related note, asymmetry, invariant, first-principles, boundary, flow-gap) independently found and traced this exact contradiction; I verified it directly against the deployed source.

Impact is bounded to availability (DoS), not fund loss — and the AZL/WETH V4 pool is documented (constructor comment, `BaseAzlExactInputExecutor.sol:90-94`) as a permanently-locked launchpad pool with a bricked migration path, which reduces (but does not eliminate) the realistic likelihood of the pool's active-range liquidity ever reaching zero through normal LP withdrawal.

**Fix**
```diff
  function maxAdmissibleWethInput() public view returns (uint256 amountIn) {
-     (uint160 sqrtPriceX96, int24 tick,) = _readPoolSnapshot();
-     uint128 liquidity = _readLiquidity();
-     if (liquidity == 0) return 0;
+     bytes32 stateSlot = _poolStateSlot();
+     uint256 packedSlot0 = uint256(IV4PoolManager(POOL_MANAGER).extsload(stateSlot));
+     uint160 sqrtPriceX96 = uint160(packedSlot0);
+     if (sqrtPriceX96 == 0) return 0;
+     uint128 liquidity = _readLiquidity();
+     if (liquidity == 0) return 0;
+     int24 tick = int24(uint24(packedSlot0 >> 160));
```
i.e. read price/liquidity without routing through the hard-reverting `_readPoolSnapshot()`, so the zero-liquidity case degrades gracefully as intended. (Illustrative fix — the exact refactor should preserve `_readPoolSnapshot`'s tick/sqrtPrice consistency check for the non-zero-liquidity path.)

---

[65] **4. Oracle-priced USDC depth cap vs. pool-priced WETH fill can spuriously revert legitimate near-cap deposits**

`AzlPaymentGateway.fundWithUsdc()` / `BaseAzlExactInputExecutor._swapWethForAzl()` · Confidence: 65

**Description**
The USDC-path depth cap (`AzlPaymentGateway.sol:135`, `usdcDepthCap = oracle.quoteEthUsd6(executor.maxAdmissibleWethInput())`) sizes the allowed USDC input using the **oracle's** ETH/USD price. The actual USDC→WETH conversion executes at the **Uniswap V3 pool's** price (`BaseUsdcWethExactInputLeg`). If the V3 pool's implied ETH price diverges from the oracle's, the WETH the leg actually returns can exceed `maxAdmissibleWethInput()`, and `_swapWethForAzl`'s independent re-check (`BaseAzlExactInputExecutor.sol:251`, `require(amountIn <= maxAdmissibleWethInput())`) reverts a transaction that had already cleared the gateway's own pre-check. Three independent Phase-2 agents (economic-security, asymmetry, flow-gap) converged on this identical two-price-source mismatch.

Impact is availability/UX only — no fund loss (atomic revert, all balance-delta invariants intact), self-correcting as the caller lowers input size, and does not affect the ETH funding path (which is bound directly to `maxAdmissibleWethInput()` with no intermediate oracle conversion).

**Recommendation**
Size the USDC depth cap from the leg's actual expected output (or re-derive the cap after the V3 leg completes, checking against `maxAdmissibleWethInput()` before attempting the AZL swap) rather than from an oracle-priced proxy for a pool-priced quantity.

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in one analysis pass, or whose materiality did not clear the 50-confidence reporting floor. Not scored._

- **Stale documentation — "direct executor bypass" comment does not match enforced guards** — `AzlPaymentGateway.sol:59-60`, `BaseAzlExactInputExecutor.sol:74-76` — Code smells: header NatSpec claims direct executor calls "bypass pause, caps, and deviation guards," but both `executeUsdcExactInput`/`executeEthExactInput` hard-`require(msg.sender == gateway)` — no such path is reachable. Confirmed by nearly every agent across both phases (8+). No security impact today; maintenance hazard if a future edit trusts the comment and relaxes the guard.
- **One-shot `configureGateway` bootstrap has no reciprocal validation** — `BaseAzlExactInputExecutor.sol:163-167` — A configurator error permanently binds the executor to the wrong address (no re-check that the target references this executor back, unlike the gateway constructor's symmetric check). Configurator-only, immutable-gated; worst case is a self-inflicted, atomically-safe deployment DoS, not third-party exploitable.
- **Hardcoded V4 `PoolManager` storage-slot offsets (`POOLS_SLOT=6`, `LIQUIDITY_OFFSET=3`, `TICK_BITMAP_OFFSET=5`)** — `BaseAzlExactInputExecutor.sol:104-106, 315-347` — 3 independent Phase-2 agents flagged this as an unverifiable-from-source trust assumption on the deployed singleton's layout. Partially self-checked via a tick/sqrtPrice consistency guard (catches gross mismatch, not a shifted-but-plausible slot). Author-asserted correct; cannot be independently re-derived without on-chain confirmation.
- **One-sided tick-tolerance window in `_readPoolSnapshot`** — `BaseAzlExactInputExecutor.sol:325-332` — accepts `getTickAtSqrtPrice(sqrt) ∈ {tick, tick+1}` but not `tick-1`; 2 agents flagged the asymmetry as a potential spurious-revert edge case at certain V4 rounding boundaries. Backstopped end-to-end by the independent post-trade `_assertRealizedImpact` check regardless.
- **USDC path assumes 1 USDC = 1 USD6 with no depeg feed** — `AzlPaymentGateway.sol:149` — fail-safe direction (depeg-down causes a revert/DoS, not mis-crediting, since the deviation floor still demands near-full-dollar AZL value).
- **Hostile/upgraded AZL, or a USDC pause/blacklist, can DoS or permanently freeze vault holdings** — `AzlPaymentGateway.sol:198-201`, various USDC transfer sites — standard shared-custody-token risk; no in-scope code fix changes the outcome if AZL turns hostile. Documented as an explicit deployment trust assumption.
- **`MAX_ETH_INPUT = 10 ether` is dead code — the $500 `MAX_USDC_INPUT6` cap always binds first** — `AzlPaymentGateway.sol:64-65, 161-163` — likely a scaling mismatch vs. deployer intent (correctness/config issue, not a security defect either direction).
- **Unverified gas-griefing loop in `_maxAmount0ToSqrtTarget`** — `BaseAzlExactInputExecutor.sol` — a `while` decrement loop reached from every funding call; one agent could not rule out an unbounded-iteration pool state but also could not construct one (expected divergence bound is 1-2 iterations from Uniswap's own rounding primitives).
- **Tick-manipulation griefing of the next victim's depth cap** — one agent noted an attacker can transiently shrink `maxAdmissibleWethInput()` for the next caller by moving the pool near a tick boundary; bounded, self-correcting, victim can retry with a smaller input.
- **Dust-input deviation-floor collapse** — `AzlPaymentGateway.sol:189` — at `inputUsd6 <= 1` (sub-micro-dollar), `minimumValue6` rounds to 0 and the deviation floor becomes a no-op; one agent confirmed this cannot be turned into value extraction because credited AZL always equals the exact in-transaction swap output regardless.
- **Sqrt-space 25bps impact bound is ~50bps in actual price terms** — `BaseAzlExactInputExecutor.sol:102, 297-299` — naming/documentation clarity only; applied consistently pre- and post-trade, no fund-risk path.
- **No Base sequencer-uptime/heartbeat check; oracle freshness fully delegated to `isValid()`** — atomic, non-leveraged design fails safe (in-flight tx reverts on deadline, no stranded funds); recommend defense-in-depth if the oracle's internal staleness handling can't be confirmed.
- **Hardcoded Uniswap/Permit2 infrastructure addresses with no migration path** — fail-safe (reverts, no fund loss) if Uniswap ever redeploys the Universal Router/PoolManager; accept-and-document or add a timelocked setter.

---

## Coverage Gate

`Entrypoints: 9 external/public state-changing in source, 9 addressed (either a finding/lead above, or explicitly examined with invariant confirmed in the Threat Model). Threat-catalog rows: 8, 8 answered. Coverage holes closed this pass: 0` — Phase 0's inventory and Phase 1 + Phase 2's combined coverage already reached every privileged/value-moving entrypoint; no additional targeted re-read was required at reconciliation.

---

> ⚠️ This review was performed by an AI-orchestrated multi-agent audit pipeline (context-building + checklist breadth + blind attacker-mindset depth + reconciliation). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. In particular, Finding M-1's real-world exploitability depends on the behavior of the `IAzlCreditVault` custody vault and the AZL token, **neither of which was provided in this job's scope** — the client should independently verify the vault's redemption/accounting semantics against the gap described. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended before and after mainnet exposure.

////

# 🔐 Security Review — Azzle V2 Vault Suite (leftclaw job 553)

> ⚠️ This review was performed by an AI-orchestrated multi-agent audit pipeline (3-phase: context-building → ethskills breadth → pashov-methodology depth, independently cross-checked). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended.

---

## Scope

| | |
|---|---|
| **Chain** | Base mainnet (chain ID 8453) |
| **Mode** | Client-specified addresses (fragmented job description, reconstructed — see note below) |
| **Contracts reviewed** | `AgentDepositVaultV2` · `EscrowVaultV2`<br>`ReputationRegistryV2` · `V2Ownable2Step` (shared base) |
| **Addresses** | `AgentDepositVaultV2` — `0x1A7eD8154dbc0a4914cf8D2181A5d5441fdDaca6`<br>`EscrowVaultV2` — `0x8AaF6c200132d82Ffc3bDE3767B8b8780188b563`<br>`ReputationRegistryV2` — `0x48D201570dAeabf32182b1371509daBDB993bf40` |
| **Source provenance** | `AgentDepositVaultV2` & `EscrowVaultV2`: Sourcify exact/partial match (chain 8453), verified `2026-08-03T21:03:27Z`. `ReputationRegistryV2`: not indexed on Sourcify at review time; pulled from BaseScan's verified-source viewer ("Exact Match"), contract name `ReputationRegistryV2` (source path `src/v2/ReputationRegistryV2.sol`), cross-checked against on-chain bytecode length. |
| **Lines in scope** | ~714 LOC across 3 core contracts + shared access-control base (excludes vendored OpenZeppelin) |
| **Confidence threshold (report floor)** | 50 |
| **Methodology** | Phase 0 (context/map, opus) → Phase 1 (6 ethskills checklists, opus) → Phase 2 (12 pashov attack agents, opus, blind to Phase 1) → Phase 3 reconciliation |

**Note on job description:** the on-chain job description for job 553 arrived as a garbled JSON fragment (`depositVault`, `escrowVault`, `reputationRegistry` address entries with a leading corrupted byte, no chain specified). We resolved the chain by confirming live bytecode at each address on Base and verified source via Sourcify/BaseScan. The description overlapped partially with sibling jobs 551/552/554 from the same client, which together appear to be fragments of one larger protocol deployment manifest (`AzzleSuiteV2Factory` ecosystem) split across multiple job postings. This job's scope was taken to be exactly the three addresses named in job 553's description.

---

## Reconciliation Summary

`Overlap: 3 · Phase-1-only: 9 · Phase-2-only: 7 · Re-examined leads kept: 2, demoted: 0 · Coverage holes closed: 0`

`Completeness: 15 unique (Contract, function) combinations flagged across both phases' raw output, 15 covered in final.`

`Coverage: 24 entrypoints in inventory, 24 addressed. 10 threat-catalog rows, 10 answered. Holes closed this pass: 0 (both phases already covered everything).`

Confidence floor for this report is 50; nothing below that floor survived to the Findings section (weaker observations are listed under Leads, unscored).

---

## Findings

[80] **1. `ReputationRegistryV2`: a single dispute can double-count against a poster's reputation via the anticipated timeout→resolve sequence**

`ReputationRegistryV2.recordUnresolvedDispute` + `ReputationRegistryV2.recordDispute` · Confidence: 80 · `[both — phase1: general-2 (Low); phase2: 9/12 agents, promoted to FINDING by flow-gap-hunter with concrete trace]`

**Description**
`recordUnresolvedDispute` (L129-133) increments `reputation[poster].losses` but — unlike every sibling recorder — never sets `recorded[taskId]`, deliberately leaving the terminal slot open (per its own doc comment) for a later `recordDispute` call; when arbitration follows the documented, anticipated sequence (record a timeout, then later record the actual ruling), the same underlying dispute debits the poster's `losses` counter twice for one `taskId`, with no code path requiring arbitration to misbehave.

**Proof of Concept**
1. Arbitration calls `recordUnresolvedDispute(taskId=5, poster=P)` → `reputation[P].losses` becomes 1; `recorded[5]` stays `false` (L131, no set).
2. Arbitration later resolves the dispute normally: `recordDispute(taskId=5, winner=W, loser=P, neutral=false)` → passes its own `require(!recorded[5])` (still false) → `reputation[P].losses` becomes 2 (L120), `recorded[5]` now `true`.
3. One dispute has produced two loss entries against `P`. This is the exact sequence the code's own comments (L126-128) describe as the intended design — not an arbitration bug.

**Fix**

```diff
     function recordUnresolvedDispute(uint256 taskId, address poster) external onlyArbitration {
         require(taskId != 0 && !recorded[taskId] && poster != address(0), "RRv2: unresolved");
-        reputation[poster].losses++;
+        // Track separately from `recorded` so a later recordDispute() cannot double-count.
+        require(!unresolvedRecorded[taskId], "RRv2: unresolved already recorded");
+        unresolvedRecorded[taskId] = true;
+        reputation[poster].losses++;
         emit UnresolvedDisputeRecorded(taskId, poster);
     }
```
(Add `mapping(uint256 => bool) public unresolvedRecorded;` and, if double-counting is the concern rather than repeatability, additionally consider not incrementing `losses` at all here — an unresolved timeout is explicitly documented as "not a claim the poster was wrong" — and instead rely solely on the later `recordDispute` for the authoritative loss/win tally.)

---

[75] **2. `AgentDepositVaultV2.debitExitFee` is missing the `harmed != account` guard its own view helper and sibling function both enforce**

`AgentDepositVaultV2.debitExitFee` · Confidence: 75 · `[both — phase1: general-1 (Low); phase2: 9/12 agents independently converged]`

**Description**
The advisory view `canResolveTask` (L217) requires `harmed != defaulter`, and the sibling state-changing function `debitAccessFeeTo` (L261) requires `recipient != account`, but the actually state-changing `debitExitFee` (L222-225) only requires `harmed != address(0)` — omitting the self-payment guard present in both its own precondition-checker and its sibling.

**Proof of Concept**
With `reservation = {amount: 50, exitCompensation: 30, exitProtocolShare: 20}` and `deposits[defaulter] = 100`: calling `debitExitFee(taskId, defaulter, harmed=defaulter)` passes all requires (`harmed != address(0)` ✓, `fee(50) <= amount(50)` ✓, `deposits(100) >= fee(50)` ✓), deletes the reservation, debits 50 from `deposits[defaulter]`, then `_payOrDefer(defaulter, 30)` pays the `exitCompensation` straight back to the defaulter — only the 20-unit `exitProtocolShare` is a real penalty, and no third party is compensated at all. `canResolveTask` would have returned `false` for this exact input (L217: `harmed != defaulter`), so any registry consulting its own advisory view before calling would be inconsistent with what the mutator actually allows.

**Fix**

```diff
     function debitExitFee(uint256 taskId, address account, address harmed) external onlyRegistry nonReentrant {
         TaskReservation memory reservation = taskReservations[taskId][account];
         uint256 fee = reservation.exitCompensation + reservation.exitProtocolShare;
-        require(harmed != address(0) && reservation.amount > 0 && fee > 0, "ADv2: exit");
+        require(harmed != address(0) && harmed != account && reservation.amount > 0 && fee > 0, "ADv2: exit");
         require(fee <= reservation.amount && deposits[account] >= fee, "ADv2: exit funds");
```

---

[65] **3. Unguarded `treasury.recordRevenue()` / `policy.quoteTask()` external calls can revert and block the core reservation and exit-fee paths for every user**

`AgentDepositVaultV2.reserveTask`, `AgentDepositVaultV2.debitExitFee` · Confidence: 65 · `[both — phase1: dos-2, dos-3; phase2: boundary + trust-gap agents]`

**Description**
`_payOrDefer` (used for every registry/arbitration-triggered payout) is specifically designed to never revert on an unpayable recipient — it defers to a `pendingPayouts` ledger instead. That design is undermined immediately afterward: `reserveTask` (L193) and `debitExitFee` (L240) both call `ITreasuryRevenueV2(treasury).recordRevenue(...)` with no try/catch, right after a successful immediate payout. If the trusted `treasury` contract ever reverts inside `recordRevenue` (bug, pause, upgrade), the entire reservation or exit-fee-debit transaction reverts — bricking these flows for every user, not just the caller.

**Proof of Concept**
Not third-party-triggerable — requires the owner-configured, out-of-scope `treasury` contract to be broken. Trace: `reserveTask` pays the access fee to `treasury` via `_payOrDefer` (succeeds), then unconditionally calls `treasury.recordRevenue(fee)` (L193) with no error handling; a revert there unwinds the entire `reserveTask` call, including the collateral lock that had already succeeded.

**Fix**

```diff
-            if (_payOrDefer(treasury, fee)) ITreasuryRevenueV2(treasury).recordRevenue(fee);
+            if (_payOrDefer(treasury, fee)) {
+                try ITreasuryRevenueV2(treasury).recordRevenue(fee) {} catch {}
+            }
```
(apply the same pattern at L240 in `debitExitFee`)

---

[60] **4. Compensation payouts routed to `treasury` get booked as protocol revenue, and revenue recording is inconsistent between the immediate-pay and deferred-pay branches**

`AgentDepositVaultV2.debitExitFee`, `AgentDepositVaultV2.debitAccessFeeTo`, `AgentDepositVaultV2.claimPayout` · Confidence: 60 · `[phase2-only — access-control, invariant, asymmetry, trust-gap agents]`

**Description**
If the registry ever names `treasury` as the `harmed` party (`debitExitFee`) or `recipient` (`debitAccessFeeTo`) — neither of which is guarded against — the resulting payout is compensation, not revenue, yet: (a) on the immediate-pay branch, no `recordRevenue` call is made for that leg at all (only the `exitProtocolShare`/access-fee legs call it), while (b) on the deferred-pay branch, `claimPayout`'s treasury branch (L285) books the *entire* `pendingPayouts[treasury]` balance as revenue regardless of what it's actually made of. Revenue accounting can therefore over- or under-count depending purely on whether a transfer happened to defer.

**Fix**
Track compensation-vs-revenue provenance per pending amount (e.g. a `pendingRevenue[recipient]` sub-ledger credited only from the fee/share legs), and have `claimPayout` record only that sub-amount as revenue rather than the whole `pendingPayouts[treasury]` balance.

---

[55] **5. No emergency pause and no re-wire path if a trusted external dependency is compromised; one-shot `configure()` mis-wire is permanent**

`AgentDepositVaultV2`, `EscrowVaultV2`, `ReputationRegistryV2` (all: `configure()`) · Confidence: 55 · `[phase1: access-1, access-2]`

**Description**
`gateway`/`registry`/`arbitration`/`treasury`/`policy` are wired exactly once via owner-only `configure()`, with no setter afterward (grep-confirmed no other assignment site in any of the three contracts). If any of these trusted external contracts is later compromised or found buggy, or if `configure()` itself was called with a wrong-but-valid address, the owner has no on-chain lever to pause value-moving flows or re-point the wiring — only `rescueSurplus` (surplus above tracked liabilities) and ownership transfer exist as owner tools.

**Fix**
Add an owner-controlled `Pausable` guard on the registry/arbitration/gateway-driven entrypoints (never on self-service `withdraw`/`claimPayout`, so users are never trapped), and consider folding `validateGraph()`'s cross-contract checks into `configure()` itself so a mis-wire reverts at wiring time rather than only being detectable later.

---

[50] **6. `_payOrDefer`'s "never revert" guarantee is contingent entirely on `azl` being the asserted standard, hookless, non-fee-on-transfer token**

`AgentDepositVaultV2._payOrDefer`, `EscrowVaultV2._payOrDefer` · Confidence: 50 · `[both — phase1: erc20-1, erc20-2; phase2: 4 agents on cross-contract-reentrancy corroborate the same seam]`

**Description**
Both vaults' delta-check defenses correctly prevent silent accounting corruption under any weird-token behavior, but the "graceful defer to `pendingPayouts` instead of reverting" property that `_payOrDefer` is explicitly built for (per its own code comments) does **not** hold under fee-on-transfer or hook/ERC777-style token behavior — a partial or hook-triggered balance move still fails the strict `require(afterBalance == beforeBalance && recipientAfter == recipientBefore)` (ADv2 L328 / Ev2 L192), reverting the whole transaction instead of deferring, which is the opposite of the design's stated intent. Additionally, `AgentDepositVaultV2` and `EscrowVaultV2` hold independent `ReentrancyGuard` storage, so a hostile token callback in one vault's `_payOrDefer` could in principle reenter the other vault — no exploit was constructed because every reentrant target is itself self-scoped and delta-checked.

**Fix**
No code change required if `azl` is permanently guaranteed standard (it is `immutable`, which helps). If broader token robustness is ever desired: drop the recipient-side delta assertion in the failure branch (keep only the sender-side check + `ok`/`validReturn`), so a recipient manipulating its own post-receipt balance cannot force a revert.

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path is gated behind a trusted actor or an unverifiable external assumption. Not scored._

- **Stale `taskQuotes` reuse** — `AgentDepositVaultV2.reserveTask` — Code smells: `taskQuotes[taskId]` is written once (L164) and never deleted by any terminal function. A terminated `(taskId, account)` reservation could be reopened with `createQuote=false`, silently reusing a stale price quote if the registry ever reuses a `taskId`. Impact depends entirely on off-chain registry behavior not verifiable from this scope.
- **`EscrowVaultV2` FROZEN escrows have no permissionless recovery path** — `EscrowVaultV2.freeze`/`settle`/`refund` — Code smells: once `freeze()` moves an escrow to FROZEN, only arbitration's `settle()` can terminate it (`refund`/`release` both require FUNDED, L120/L157); `ReputationRegistryV2`'s own comment ("Escrow still refunds the poster on timeout", L128) implies a timeout-refund path that does not exist in `EscrowVaultV2`'s code — a poster-refund-on-timeout must actually mean arbitration calling `settle(0)`. If arbitration never acts, escrowed funds are locked indefinitely with no on-chain backstop.
- **No permissionless timeout for a stuck `AgentDepositVaultV2` reservation** — `reserveTask`/`releaseTask`/`debitExitFee`/`debitAccessFeeTo` — Code smells: all three terminal functions are `onlyRegistry`; if the registry never calls one for a given reservation, the account's locked collateral and floor-restricted balance have no self-service exit.
- **`_payOrDefer` self-recipient stranding** — both vaults — Code smells: no check that `recipient != address(this)`; a self-directed payout would fail the delta check and silently strand funds in an uncollectable `pendingPayouts[address(this)]` slot, inflating tracked liabilities with no way to ever claim them.
- **`credit()` doesn't distinguish fresh inflow from pre-existing surplus** — `AgentDepositVaultV2.credit` — Code smells: the solvency check (`balanceOf >= liabilities() + amount`) is satisfied by donated/surplus AZL as readily as by funds the gateway actually just transferred in; purely an accounting-precedence note, not independently exploitable.
- **`latchedEntryFloor` peak-and-hold over-locks a user's own funds** — `AgentDepositVaultV2` — Code smells: the floor only clears when an account's *entire* reservation streak reaches zero, not per-task; self-harm only, matches documented design.
- **`totalReserved` is a write-only dead accumulator** — `AgentDepositVaultV2` — written at 4 sites, read at none; provides no actual on-chain safety guarantee despite looking like one.
- **Dead `onlyArbitration` modifier in `AgentDepositVaultV2`** — defined (L96) but used by no function; unnecessarily enlarges the trusted-address surface for no functional gain.
- **Floating pragma / unpinned `evmVersion`** — all in-scope files use `^0.8.24` with no build-config pin; no impact on the current Base deployment (already live and verified), portability/reproducibility note only.

---

## Access-Control Inventory

| Function | Guard | Caller | Moves AZL |
|---|---|---|---|
| `ADv2.configure` | onlyOwner, one-shot | owner | no |
| `ADv2.credit` | onlyGateway + nonReentrant | gateway | no (balance-check gated) |
| `ADv2.withdraw` | msg.sender-scoped + nonReentrant | any (own funds) | yes |
| `ADv2.reserveTask` | onlyRegistry + nonReentrant | registry | yes → treasury (fee) |
| `ADv2.releaseTask` | onlyRegistry | registry | no |
| `ADv2.debitExitFee` | onlyRegistry + nonReentrant | registry | yes → harmed + treasury |
| `ADv2.debitAccessFeeTo` | onlyRegistry + nonReentrant | registry | yes → recipient |
| `ADv2.claimPayout` | msg.sender-scoped + nonReentrant | any (own funds) | yes |
| `ADv2.rescueSurplus` | onlyOwner + nonReentrant | owner | yes |
| `Ev2.configure` | onlyOwner, one-shot | owner | no |
| `Ev2.create` | onlyRegistry | registry | no |
| `Ev2.fund` | onlyRegistry + nonReentrant | registry | yes (pulls from poster) |
| `Ev2.freeze` | onlyArbitration | arbitration | no |
| `Ev2.release` | onlyRegistry + nonReentrant | registry | yes → worker |
| `Ev2.close` | onlyRegistry | registry | no |
| `Ev2.settle` | onlyArbitration + nonReentrant | arbitration | yes → worker + poster |
| `Ev2.refund` | onlyRegistry + nonReentrant | registry | yes → poster |
| `Ev2.claimPayout` | msg.sender-scoped + nonReentrant | any (own funds) | yes |
| `Ev2.rescueSurplus` | onlyOwner + nonReentrant | owner | yes |
| `RRv2.configure` | onlyOwner, one-shot | owner | no |
| `RRv2.recordCompletion` | onlyRegistry | registry | no |
| `RRv2.recordPosterExpiry` | onlyRegistry | registry | no |
| `RRv2.recordDispute` | onlyArbitration | arbitration | no |
| `RRv2.recordUnresolvedDispute` | onlyArbitration | arbitration | no |

**Roles.** Single two-step, non-renounceable `owner` per contract. `gateway`/`registry`/`arbitration`/`treasury` (ADv2) and `registry`/`arbitration` (Ev2, RRv2) are wired exactly once via owner-only `configure()` — grep-confirmed no other setter exists.

**Unguarded (arbitrary-caller) state-changing entrypoints — exactly 3, all self-scoped:** `ADv2.withdraw`, `ADv2.claimPayout`, `Ev2.claimPayout`. Each is strictly bounded to `msg.sender`'s own recorded balance; no arbitrary-recipient theft path exists.

---

## Threat Model

| Actor | Reaches | Could gain | Status |
|---|---|---|---|
| Compromised/buggy `registry` | `reserveTask` quote/reuse misuse | Wrong collateral lock across parties | Invariant holds structurally; `taskQuotes` staleness is a Lead |
| Compromised/buggy `registry` | `debitExitFee` w/ `harmed==account` | Defaulter recovers own compensation | **Addressed by Finding #2** |
| Compromised/buggy `registry` | `Ev2.fund` w/ unrelated pre-approved poster | Pulls unrelated approved AZL | Invariant holds — `create()` must precede `fund()`, registry-gated |
| Compromised/buggy `arbitration` | `Ev2.settle` adversarial `workerBps` | Skews FROZEN escrow split | Invariant holds — bounded ≤10000, fully trusted by design |
| Compromised/buggy `arbitration` | `recordDispute`/`recordUnresolvedDispute` | Fabricated/duplicated reputation | **Addressed by Finding #1** (goes beyond fabrication — fires on *correct* usage) |
| Any address | `withdraw`/`claimPayout` self-scoped | Only own recorded balance | Invariant holds — verified structurally by 12 independent agents |
| Owner | `rescueSurplus` | Any balance above tracked liabilities | Invariant holds — guard formula verified correct on both vaults |
| Owner | `configure()` timing | Permanent mis-wire, no recovery | **Addressed by Finding #5** |
| Malicious/hostile `azl` token hook | Reentry during `_payOrDefer` | Cross-contract reentrancy | **Addressed by Finding #6** — no exploit constructed, contingent on token assumption |
| Anyone unprivileged | — | — | No unguarded value-moving entrypoint beyond self-scoped functions exists (inventory-complete) |

---

## Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [80] | ReputationRegistryV2 reputation double-count via anticipated timeout→resolve sequence |
| 2 | [75] | AgentDepositVaultV2.debitExitFee missing harmed != account guard |
| 3 | [65] | Unguarded treasury.recordRevenue()/policy.quoteTask() calls can DoS core flows |
| 4 | [60] | Treasury-routed compensation misclassified as revenue |
| 5 | [55] | No emergency pause / permanent one-shot configure() mis-wire risk |
| 6 | [50] | _payOrDefer's non-reverting guarantee contingent on standard-token assumption |

---

*Generated by an autonomous 3-phase audit pipeline: Phase 0 context (3 agents) → Phase 1 breadth (6 ethskills checklist agents) → Phase 2 depth (12 pashov attack agents, blind to Phase 1) → Phase 3 reconciliation. All findings independently corroborated across phases where noted; every file:line citation was verified against the live source before publication.*

////

# 🔐 Security Review — Azzle V2 Task Orchestration Layer (leftclaw job 554)

> ⚠️ This review was performed by an AI-orchestrated multi-agent audit pipeline (3-phase: context-building → ethskills breadth → pashov-methodology depth, independently cross-checked). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Team security reviews, bug bounty programs, and on-chain monitoring are strongly recommended.

---

## Scope

| | |
|---|---|
| **Chain** | Base mainnet (chain ID 8453) |
| **Mode** | Client-specified addresses (fragmented job description, reconstructed — same client/protocol as leftclaw job 553) |
| **Contracts reviewed** | `TaskRegistryV2` · `ArbitrationModuleV2` · `V2Ownable2Step` (shared base) |
| **Addresses** | `TaskRegistryV2` — `0x5126022A836d47A1c39Cea48A9ef89fAE88772B6`<br>`ArbitrationModuleV2` — `0x2501988000Df2CF1c98c14d33113DF5Dc1a4DC90` |
| **Source provenance** | `TaskRegistryV2`: Sourcify "match" (chain 8453). `ArbitrationModuleV2`: not indexed on Sourcify at review time; pulled from BaseScan's verified-source viewer ("Exact Match"), contract name `ArbitrationModuleV2`, cross-checked against on-chain bytecode length. |
| **Lines in scope** | ~976 LOC across 2 core contracts + shared access-control base (excludes vendored OpenZeppelin/Uniswap FullMath) |
| **Confidence threshold (report floor)** | 50 |
| **Methodology** | Phase 0 (context/map, opus) → Phase 1 (6 ethskills checklists, opus) → Phase 2 (12 pashov attack agents, opus, blind to Phase 1) → Phase 3 reconciliation |

**Relationship to leftclaw job 553:** `TaskRegistryV2` is the `registry` and `ArbitrationModuleV2` is the `arbitration` contract that job 553's three vault contracts (`AgentDepositVaultV2`, `EscrowVaultV2`, `ReputationRegistryV2`) treat as an external, out-of-scope trusted caller. Job 553's own report flagged that trust boundary as unverifiable from its scope. This job closes that gap by auditing the caller side directly — and the findings below (particularly Finding #1) are entrapment of exactly the kind job 553's threat model anticipated: the orchestration layer, not the vaults, contains this engagement's most severe defect.

---

## Reconciliation Summary

`Overlap: 6 · Phase-1-only: 5 · Phase-2-only: 4 · Re-examined leads kept: 2, demoted: 0 · Coverage holes closed: 0`

`Completeness: 14 unique (Contract, function) combinations flagged across both phases' raw output, 14 covered in final.`

`Coverage: 18 entrypoints in inventory, 18 addressed. 10 threat-catalog rows, 10 answered. Holes closed this pass: 0 (both phases already covered everything).`

Confidence floor for this report is 50. Finding #1 is corroborated by **all 12 of 12** Phase 2 agents plus 2 of 6 Phase 1 agents (14 total independent confirmations, unanimous within Phase 2) — the strongest convergence observed across either job in this engagement.

---

## Findings

[95] **1. `ArbitrationModuleV2.assignArbitrator`'s ruling-phase branch is mathematically unreachable — a panel-saturated dispute can never get an arbitrator and is forced into a poster-favorable timeout that strips a deserving worker of their entire escrow**

`ArbitrationModuleV2.assignArbitrator` · Confidence: 95 · `[both — phase1: general-1 + chain-1 (independently, with algebraic proof); phase2: 12/12 agents unanimous]`

**Description**
`resolutionDeadline = d.evidenceDeadline + rulingWindow` (L228); `assignable` requires `block.timestamp + rulingWindow <= resolutionDeadline` (L229-230), which is algebraically identical to `block.timestamp <= d.evidenceDeadline`, independent of `d.status`. But `Status.RULING` is reachable only via `beginRuling()` (L252-258), which itself requires `block.timestamp > d.evidenceDeadline` (L254). The two conditions are mutually exclusive: **the `if (d.status == Status.RULING) { d.rulingDeadline = ... }` branch at L237-239 can never execute.** This directly contradicts the function's own doc comment ("assigns bond before ruling phase deadlines elapse", L223-224) and the existence of the dead branch itself proves the ruling-phase back-fill was the intended design.

**Proof of Concept**
1. A dispute opens (`ArbitrationModuleV2.openDispute`, triggered via `TaskRegistryV2.openDispute`) while every eligible panel member is already assigned to other concurrent disputes — `_nextArbitrator` returns `address(0)` (L356), and per L216 no `bonds.assign` is made. The dispute proceeds with `arbitrator == address(0)`, status `EVIDENCE`, `evidenceDeadline = now + evidenceWindow`.
2. No panel slot frees up (or no one calls `assignArbitrator`) before `evidenceDeadline`.
3. Anyone calls `beginRuling(taskId)` (permissionless) once `block.timestamp > evidenceDeadline` — status flips to `RULING`.
4. From this point, **for all future timestamps**, `assignArbitrator`'s `assignable` check is false (`block.timestamp` is now `> evidenceDeadline` and only grows), so every future call reverts `"AMv2: assignment window"`.
5. `rule()` (L260) requires `msg.sender == d.arbitrator`, but `d.arbitrator == address(0)` forever — unmatchable by any address. The dispute can never be ruled.
6. The sole remaining path is the permissionless `timeout()` (L276), which unconditionally settles `Outcome.MUTUAL` with `workerBps = 0` (L296) — **100% of the disputed escrow refunds to the poster**, regardless of whether the worker actually delivered and was owed the funds. `ArbitrationModuleV2._settle` then calls `TaskRegistryV2.resolveDispute` with the MUTUAL outcome, and `resolveDispute`'s neutral-outcome branch applies no `debitExitFee`.

Concrete numbers: with `evidenceWindow = rulingWindow = 1 day`, opening at `t=1000`: `evidenceDeadline = 87400`, `resolutionDeadline = 173800`. At `t=87401` (just past evidence deadline, status now RULING), `assignArbitrator` requires `87401 + 86400 = 173801 <= 173800` — false, reverts. This holds for every later `t` as well.

**No privileged action or external-dependency misbehavior is required** — ordinary panel congestion during a single evidence window is sufficient. One Phase 2 agent additionally demonstrated this is directly weaponizable: an attacker can deliberately occupy every eligible panel slot with concurrent disputes at the moment a targeted victim's dispute opens, guaranteeing that dispute is funneled into the dead-branch trap and forced to a poster-favorable outcome.

**Fix**

```diff
     function assignArbitrator(uint256 taskId) external nonReentrant returns (address arbitrator) {
         Dispute storage d = disputes[taskId];
         require(d.arbitrator == address(0), "AMv2: assigned");
-        uint256 resolutionDeadline = uint256(d.evidenceDeadline) + rulingWindow;
-        bool assignable = (d.status == Status.EVIDENCE || d.status == Status.RULING)
-            && block.timestamp + rulingWindow <= resolutionDeadline;
+        bool assignable = (d.status == Status.EVIDENCE && block.timestamp <= d.evidenceDeadline)
+            || (d.status == Status.RULING && block.timestamp <= d.rulingDeadline);
         require(assignable, "AMv2: assignment window");
         (address poster, address worker) = registry.taskParties(taskId);
         arbitrator = _nextArbitrator(poster, worker);
         require(arbitrator != address(0), "AMv2: no bonded panel");
         d.arbitrator = arbitrator;
         bonds.assign(arbitrator);
         if (d.status == Status.RULING) {
             d.rulingDeadline = uint64(block.timestamp) + rulingWindow;
         }
         emit ArbitratorAssigned(taskId, arbitrator);
     }
```
This makes the existing (currently dead) RULING branch reachable, so a late-freed panel member can still be assigned and given a fresh ruling window, matching the function's documented intent.

---

[80] **2. Owner can defeat the documented "no post-evidence arbitrator picking" invariant by mutating panel membership while a dispute sits unassigned, steering it to a chosen arbitrator who then controls the escrow split**

`ArbitrationModuleV2.addPanelMember` / `removePanelMember` / `assignArbitrator` · Confidence: 80 · `[phase1: access-1; phase2: ~6 agents, 2 exploit variants]`

**Description**
The contract's own header comment states the design guarantee: *"No owner can pick an arbitrator after seeing case evidence"* (L76-77), enforced by round-robin selection plus deliberate index-stable removal (`removePanelMember` zeroes a slot in place rather than swap-and-pop, specifically "to prevent governance from repositioning a chosen member into the next round-robin slot after seeing a case", L162-164). This guarantee is bypassable, in two ways:

- **Addition variant** (no removal needed): when a dispute opens with `arbitrator == address(0)` (panel momentarily saturated or all-ineligible — a normal, non-adversarial condition per Finding #1), the case and its evidence hash are already public. The owner can simply call `addPanelMember(colluder)` before the next `assignArbitrator` call. `_nextArbitrator` re-scans the *live* panel and will select the newly-added colluder if they are the only eligible non-party candidate at that moment.
- **Removal variant**: owner adds a colluding bonded member, then calls `removePanelMember` on every other eligible idle competitor. `removePanelMember`'s only guards are `!bonds.canRelease(member)` (no active assignment) and a last-eligible-member check (L154-157) — neither prevents eliminating every competitor *except* the colluder.

Either way, the colluding arbitrator is then deterministically selected by the permissionless `assignArbitrator`, calls `rule(taskId, <favored outcome>, <bps>)`, and `_settle` → `escrow.settle` moves the full disputed escrow accordingly.

**Proof of Concept**
Panel `[A]` where `A` happens to be a party to the dispute (or otherwise ineligible) at open — `_nextArbitrator` returns `address(0)`, dispute opens unassigned. Owner calls `addPanelMember(C)` where `C` is a bonded confederate. `assignArbitrator(taskId)` → `_nextArbitrator` scans from the cursor: index 0 = `A` (party, skipped), index 1 = `C` (eligible, non-party) → `C` selected. `C` calls `rule(taskId, WORKER_WINS, 10000)` → `escrow.settle` routes 100% of escrow to the (potentially owner-colluding) worker; the honest poster loses their funds — or the symmetric case with `POSTER_WINS` against an honest worker.

This requires a malicious or compromised owner, which would normally gate it out under a strict admin-action reading — but the finding clears that gate because the harm flows through an **access gap**: the specific anti-gaming mechanism the code claims to provide (and goes out of its way to implement via non-standard array handling) does not actually hold. This is the access mechanism itself being the bug, not merely "an admin can do admin things."

**Fix**
Snapshot the eligible-candidate set (or at minimum the panel length + cursor) at `openDispute` time, and require `assignArbitrator` to select only from that frozen snapshot rather than the live, owner-mutable `panel`/`authorized` state. Alternatively, disallow `addPanelMember`/`removePanelMember` while any dispute has `arbitrator == address(0)` pending assignment.

---

[65] **3. `ArbitrationModuleV2.timeout()` bounds-checks the wrong quantity against the external bond reserve, risking a permanently frozen dispute**

`ArbitrationModuleV2.timeout` · Confidence: 65 · `[phase2: math-precision + others]`

**Description**
L289-294 computes `cap = minimumBond * slashCapBps / 10_000` and requires `cap <= bonds.assignmentReserve()` (L290) *before* computing the actually-slashed `amount = min(cap - d.slashed, bonds.bonds(arbitrator))` (L291-293). The guard checks the full theoretical cap, not the smaller real amount that will be slashed. `timeout()` is the *only* resolution path for a dispute with an assigned-but-silent arbitrator (`rule()` is time-barred, `assignArbitrator` requires `d.arbitrator == address(0)`). If the external bond vault's `assignmentReserve()` ever sits between the true `amount` and the larger `cap`, `timeout` reverts and the dispute — plus its frozen escrow — has no further resolution path in this contract.

**Fix**
Bound-check the actual `amount` to be slashed, not `cap`:
```diff
-            uint256 cap = (bonds.minimumBond() * slashCapBps) / 10_000;
-            require(cap <= bonds.assignmentReserve(), "AMv2: slash reserve");
             uint256 intended = cap > d.slashed ? cap - d.slashed : 0;
             uint256 bonded = bonds.bonds(d.arbitrator);
             amount = intended < bonded ? intended : bonded;
+            require(amount <= bonds.assignmentReserve(), "AMv2: slash reserve");
```

---

[60] **4. Non-dispute terminal paths (`complete`/`cancel`/`expire`) settle Action Credits without the settleability preflight that the dispute path has, risking a bricked liveness fallback**

`TaskRegistryV2._settleCredits` (via `_finalizeCompletion`, `cancel`, `expire`) · Confidence: 60 · `[both — phase1: general-2; phase2: ~6 agents]`

**Description**
`resolveDispute` (and the `canResolveDispute` view `ArbitrationModuleV2._settle` consults) gates on `staking.canSettleSpentCredit(...)` before ever calling `settleSpentCredit` (L466-471, L443-444). The code's own comment (L522-524) concedes this preflight is "enforced on dispute resolution but not on all terminal paths" — `_finalizeCompletion` (L547), `cancel` (L347), and `expire` (L388/391/393) call `_settleCredits` → `staking.settleSpentCredit` directly, with no such check. With zero `try/catch` anywhere in scope, a spent credit that the external staking contract cannot currently settle would make these calls revert atomically — including `expire()`, the permissionless liveness fallback that is supposed to guarantee every task eventually reaches a terminal state.

**Fix**
Mirror the dispute-path preflight on the other terminal paths:
```diff
     function _settleCredits(uint256 taskId, address poster, address posterRecipient, address workerRecipient) internal {
         if (taskPosterCredit[taskId]) {
             delete taskPosterCredit[taskId];
+            require(staking.canSettleSpentCredit(taskId, poster, true), "TRv2: poster credit");
             staking.settleSpentCredit(taskId, poster, posterRecipient, true);
         }
         if (taskWorkerCredit[taskId]) {
             delete taskWorkerCredit[taskId];
+            require(staking.canSettleSpentCredit(taskId, tasks[taskId].worker, false), "TRv2: worker credit");
             staking.settleSpentCredit(taskId, tasks[taskId].worker, workerRecipient, false);
         }
     }
```

---

[55] **5. Oracle cluster: USD6 exposure-cap accounting trusts an unvalidated, potentially manipulable/stale oracle — cap bypass, permanent griefing, and revert-DoS, but never direct fund theft**

`TaskRegistryV2.post`/`fund` · Confidence: 55 · `[both — phase1: oracle-1/2/3/4; phase2: multiple agents independently verified the arithmetic is conservative]`

**Description**
`usdOracle.quoteUsdForAzlPar` is consumed at `post()` (L218) and `fund()` (L264) with only `>0`/cap bounds. `IAzlUsdOracle.isValid()` is declared but never called anywhere in scope, and there's no `try/catch`. Three distinct consequences, all confined to the USD6 *cap-accounting* layer (every actual token movement is a fixed AZL-wei amount, never oracle-derived — confirmed by multiple Phase 2 agents, so this is never a fund-theft vector): (a) an actor who manipulates the oracle across both the `post()` and `fund()` quotes can admit large AZL exposure while the cap accounting registers almost nothing; (b) the up-only ratchet (`newFundedUsd6` never decreases, L266-268) means a single-block upward spike permanently over-consumes cap headroom even after the price recovers — a griefing DoS on future posters; (c) a reverting oracle (immutable `usdOracle`, no replacement path) permanently bricks `post()`/`fund()`, though existing tasks still reach terminal states via `expire()` since no terminal path calls the oracle.

**Fix**
Gate both call sites on `usdOracle.isValid()`; consider a TWAP/validated-push source rather than a raw spot quote if the cap is meant to be a hard risk bound; allow the funded-basis to decrease when `_reconcileOpenTaskAmount` observes a lower live price rather than only ever ratcheting up.

---

[50] **6. `ArbitrationModuleV2.panel` array only grows, never shrinks; loops over it make per-element external calls and are reachable by permissionless callers**

`ArbitrationModuleV2._nextArbitrator` / `_hasEligiblePanelMemberExcluding` · Confidence: 50 · `[both — phase1: dos-1/access-4/general-6; phase2: corroborated]`

**Description**
`removePanelMember` deliberately zeroes a slot instead of shrinking the array (L163-166, to preserve round-robin index stability — the same design intent behind Finding #2). Every `addPanelMember`/`removePanelMember` churn cycle nets +1 permanent dead slot. `_nextArbitrator` makes a `bonds.isEligible()` external call per scanned element in a full-length loop, reachable via `openDispute` (party-triggered) and the permissionless `assignArbitrator`. Growth is owner-gated so this is not attacker-triggerable on demand, but sufficient long-term churn could eventually make dispute assignment unschedulable (block-gas-limit), at which point `removePanelMember` (same loop) also becomes unusable to fix it.

**Fix**
Reuse zeroed slots when adding a new member instead of always `push`ing, keeping `panel.length` bounded by peak concurrent membership while preserving the index-stability property (a *new* member filling a hole is not a previously-known adjudicator being repositioned).

---

## Leads

_Findings below the confidence floor, or dependent entirely on out-of-scope contract behavior that could not be verified. Not scored._

- **Silent-arbitrator griefing** — `ArbitrationModuleV2.rule`/`timeout` — a single assigned arbitrator can unilaterally force the poster-favorable MUTUAL/`timeout` outcome just by refusing to rule; their only cost is a capped bond slash.
- **Dispute-to-dodge-default griefing** — `TaskRegistryV2.openDispute` — a poster who received timely delivery can open a dispute (within the 12h grace) to trade `expire()`'s worker-compensating default penalty for `timeout()`'s no-compensation outcome, if arbitration then stalls (amplified by Finding #1).
- **Claim-and-stall fee extraction** — `TaskRegistryV2.claim`/`expire` — a griefer can claim an arbitrary task, never fund/deliver, and receive the poster's access fee via `expire()`'s underfunded branch.
- **`expire()` accepts `State.NONE` taskIds** — cosmetic/negligible impact (near-certain external revert; any real post later overwrites the struct), included for completeness.
- **No emergency pause in either contract** — consistent with the suite's anti-rug design philosophy; flagged as a conscious trade-off, not an oversight.
- **`arbitration` one-shot-mutable rather than immutable** — structurally necessary given the circular constructor dependency between `TaskRegistryV2` and `ArbitrationModuleV2`; residual risk confined to the deploy-time trust window.

---

## Access-Control Inventory

**TaskRegistryV2** — 11 state-changing externals, all `nonReentrant`: `configureScopeRegistry`/`configureArbitration`/`configureStaking` (onlyOwner, one-shot); `post` (open, caller becomes poster); `claim` (open except poster, caller becomes worker); `fund`/`activate`/`release`/`complete`/`cancel` (poster only); `markDelivered` (worker only); `expire` (permissionless liveness fallback); `openDispute` (poster or worker); `resolveDispute` (onlyArbitration). `deposits`/`escrow`/`reputation`/`usdOracle`/`openTaskCapUsd6` are `immutable`; `arbitration`/`staking`/`scopeRegistry` are one-shot-settable plain state (no re-set path, grep-confirmed).

**ArbitrationModuleV2** — `addPanelMember`/`removePanelMember` (onlyOwner, **ongoing**, not one-shot — see Finding #2); `openDispute` (onlyRegistry); `assignArbitrator`/`beginRuling`/`timeout` (permissionless fallbacks); `submitEvidence` (poster/worker only); `rule` (assigned arbitrator only). **All** of `registry`/`escrow`/`reputation`/`bonds`/`treasury`/`evidenceWindow`/`rulingWindow`/`slashCapBps` are `immutable` — zero post-deploy setters exist for any of them (grep-confirmed). The only ongoing owner power in this contract is panel membership.

**Unguarded (arbitrary-caller) entrypoints** — none route value to `msg.sender`; each is either a self-becomes-party action (`post`, `claim`) or a fixed-outcome liveness fallback (`expire`, `assignArbitrator`, `beginRuling`, `timeout`), independently verified by multiple agents.

---

## Threat Model

| Actor | Reaches | Could gain | Status |
|---|---|---|---|
| Any address (ordinary congestion, no privilege needed) | `assignArbitrator` dead branch | Forces any panel-saturated dispute to a poster-favorable outcome | **Addressed by Finding #1** — no longer merely a threat, a confirmed defect |
| Owner (colluding) | `addPanelMember`/`removePanelMember` + `assignArbitrator` | Steers a specific open dispute's ruling | **Addressed by Finding #2** |
| Compromised/buggy `bonds` (out of scope) | `timeout`'s reserve check | Permanently freezes a dispute's escrow | **Addressed by Finding #3** |
| Compromised/buggy `staking` (out of scope) | `_settleCredits` on non-dispute paths | Bricks `expire`/`cancel`/`complete` for a credit-using task | **Addressed by Finding #4** |
| Manipulated/stale `usdOracle` (out of scope) | `post`/`fund` cap accounting | Cap bypass or permanent griefing (never fund theft — payments are fixed AZL wei) | **Addressed by Finding #5** |
| Owner (long-horizon) | Panel churn | Eventually unschedulable dispute assignment | **Addressed by Finding #6** |
| Any address | `post`/`claim` | Only becomes poster/worker on their own actions, bounded by out-of-scope vault collateral checks | Invariant holds — no unbounded gain |
| Any address | `expire`/`assignArbitrator`/`beginRuling`/`timeout` (permissionless) | Confirmed by 3+ independent agents: none route value to `msg.sender` | Invariant holds |
| Cross-contract reentrancy | `_settle`↔`resolveDispute` boundary between two independently-guarded contracts | Reenter mid-settlement | Invariant holds — every cross-call verified to hold the relevant lock on both sides, `_settle` sets SETTLED before any external call |
| Any address | Fund conservation (`openTaskTotalUsd6`/`posterOpenTaskTotalUsd6`) | Underflow/bypass via call ordering | Invariant holds — algebraically proven exact telescoping by 4+ independent agents |

---

## Findings List

| # | Confidence | Title |
|---|---|---|
| 1 | [95] | assignArbitrator dead ruling-phase branch — forces poster-favorable timeout on any deserving worker's dispute |
| 2 | [80] | Owner can steer arbitrator selection for a specific open dispute |
| 3 | [65] | timeout() bounds-checks the wrong quantity against bond reserve |
| 4 | [60] | Missing credit-settleability preflight on non-dispute terminal paths |
| 5 | [55] | Oracle cluster: cap bypass/griefing/DoS (never fund theft) |
| 6 | [50] | Ever-growing arbitrator panel, permissionlessly-iterated |

---

*Generated by an autonomous 3-phase audit pipeline: Phase 0 context (3 agents) → Phase 1 breadth (6 ethskills checklist agents) → Phase 2 depth (12 pashov attack agents, blind to Phase 1) → Phase 3 reconciliation. Finding #1 reached unanimous (12/12) independent convergence in Phase 2 alone. All findings independently corroborated across phases where noted; every file:line citation was verified against the live source before publication.*

////

# 🔐 Security Review — Azzle V2 Revenue Routing & Staking Subsystem (Job 555)

---

## Audit Target

| | |
|---|---|
| **Chain** | Base mainnet (chain 8453) |
| **Source** | Sourcify exact-match / match (compiler `0.8.24+commit.e11b9ed9`) |
| **Contracts** | `TreasuryRouterV2` @ `0xa64E6Cf8F01C56c905EcAA978C4B4388090dCbf5`<br>`TaskScopeRegistryV2` @ `0x788FA4BF2462Ed91bdFee7Ab0a962bFfa721dAC8`<br>`UnionStakingVaultV2` @ `0xE1D883C0A0ADb2f60828E6876cA4eBA80691a9d0` |
| **Files reviewed** | `TreasuryRouterV2.sol` · `TaskScopeRegistryV2.sol`<br>`UnionStakingVaultV2.sol` · `access/V2Ownable2Step.sol` |
| **Scope** | 723 LOC in-scope (excl. interfaces/vendored libs) |
| **Methodology** | Phase 0 (context map, opus) → Phase 1 (7 ethskills domain agents, opus) → Phase 2 (12 pashov attack agents, opus, blind to Phase 1) → hybrid reconciliation |

**Relation to prior work**: same "Azzle V2" client/protocol family as a previously-audited deposit-vault subsystem (a separate leftclaw job). This is an **independent engagement auditing different contracts** (revenue routing + staking, not the deposit vault) — every finding below comes from this job's own fresh 3-phase run.

**Scope note**: this job's on-chain description was truncated mid-JSON (same systemic pattern observed across this client's multi-contract submissions), with no client messages available for clarification. Scope was reconstructed from the three named addresses and confirmed via on-chain bytecode + Sourcify verification.

---

## Reconciliation Summary

**Overlap**: 4 findings independently confirmed by both Phase 1 (ethskills) and Phase 2 (pashov, blind) · **Phase-1-only**: 6 · **Phase-2-only**: 1 (promoted from a 6-agent-corroborated lead) · **Re-examined leads kept**: 1, demoted: 0 · **Coverage holes closed this pass**: 0 (all 29 entrypoints and all threat-catalog rows were already addressed by the two hunting phases).

**Notable result**: all 12 Phase-2 blind attack agents independently converged on **zero hard findings** — this is a materially more hardened codebase than typical, with exact-balance-delta assertions on nearly every AZL transfer path, conservative flooring/remainder-carrying on every division, and every unprivileged flash-loan/reentrancy/front-running attack vector cleanly defeated by time-weighted accrual design. The two Medium findings both trace to the same root pattern: **irreversible one-shot cross-contract wiring with no rescue/recovery path**, discovered independently by 3+ agents across both phases from different angles (bootstrap trust, external-call DoS, missing-rescue-accounting).

**Confidence floor**: findings below confidence 50 are demoted to a Leads note. All findings below cleared that bar.

---

## Findings

**Severity tally**: 0 Critical · 0 High · 2 Medium · 6 Low · 5 Info

[85] **1. Independent owners + irreversible one-shot cross-wiring + no rescue function on `TreasuryRouterV2` → recorded revenue can be permanently locked**

`TreasuryRouterV2.distribute()` / `configure()` / `UnionStakingVaultV2.setTreasury()` · Severity: **Medium** · Confidence: 85 · Origin: **[both]** — Phase 1 `AccessControl-1`, `DoS-2`, `General-4` (3 independent domain agents); Phase 2 economic-security and access-control agents independently re-derived the same root cause ("dependency-liveness", "init-ordering")

**Description**: `TreasuryRouterV2` and `UnionStakingVaultV2` have fully independent owners — each takes its own `initialOwner` at construction with nothing on-chain forcing them to match. Revenue can only leave the Treasury via `distribute()` (T:141-159), which synchronously calls `staking.notifyReward()` (T:155) with no try/catch. `notifyReward` only succeeds if the Staking-side owner has separately set `treasury == <this Treasury address>` via `setTreasury()` (V:124-128) — also one-shot, irreversible, and independently gated. Both cross-links (`configure()` on the Treasury side, `setTreasury()` on the Staking side) can each be set exactly once, forever.

**The critical gap**: `TreasuryRouterV2` has **no rescue/sweep function of any kind** — unlike `UnionStakingVaultV2`, which has both `rescueSurplus()` and `rescueUndistributed()`. If the cross-wiring is ever mismatched (a different treasury address set on the staking side, or `configure()` pointed at the wrong/incompatible staking contract), every `distribute()` call reverts forever, and **100% of `recordedRevenue` AZL is permanently locked with zero on-chain recovery path** — not even `withdrawReserve()` can reach it, since `reserve` is only ever populated *inside* a successful `distribute()` call. `validateGraph()` exists on both contracts (T:110-114, V:144-148) but is purely advisory: nothing calls it internally and nothing gates on it, and the Treasury's version doesn't even check `bondVault`.

**Proof**: (1) Treasury owner calls `configure(vault, stakingAddr)` (T:88-94). (2) Staking owner calls `setTreasury(wrongAddr)` — a typo, or a different Treasury instance entirely. Now `stakingAddr.treasury() != TreasuryRouterV2's address`, so `onlyTreasury` on `notifyReward` (V:176) can never be satisfied by this Treasury's calls. Every subsequent `distribute()` reverts at T:155. `distributedRevenue`/`reserve` never advance. There is no setter to correct `staking` (Treasury side) and no setter to correct `treasury` a second time (Staking side, `setTreasury`'s `require(treasury == address(0))` blocks re-calling). All `recordedRevenue` is trapped in the Treasury contract permanently. This requires no attacker — a trusted-but-uncoordinated bootstrap error between the two independently-owned contracts is sufficient.

**Fix**

```diff
+    function rescueUnallocated(address recipient, uint256 amount) external onlyOwner nonReentrant {
+        require(recipient != address(0) && amount > 0, "Tv2: rescue");
+        require(azl.balanceOf(address(this)) - reserve - distributableRevenue() >= amount, "Tv2: rescue funds");
+        _safeTransferExact(recipient, amount);
+    }
```
(mirroring `UnionStakingVaultV2.rescueSurplus`'s pattern, bounded to funds not already earmarked as `reserve` or pending distribution). Additionally, consider having `configure()`/`setTreasury()` assert the counterparty's linkage at wiring time (turning `validateGraph()` from advisory into an enforced bootstrap gate).

---

[75] **2. `notifyReward`'s dust-amount revert bricks the entire `distribute()` call — staker, burn, AND reserve legs together**

`UnionStakingVaultV2.notifyReward()` line 188 (`require(rewardRate > 0)`), triggered synchronously from `TreasuryRouterV2.distribute()` line 155 · Severity: **Low** · Confidence: 75 · Origin: **[phase1-only]** (DoS-1), independently re-confirmed as non-viable-for-third-parties by 2 Phase-2 agents (periphery, flow-gap)

**Description**: A sub-threshold `stakerAmount` (≲ `rewardDuration` wei — dust, e.g. ~1.5e-12 AZL for a 7-day duration) makes `rewardRate = scheduled / rewardDuration` floor to zero and revert with `"Sv2: small reward"` (V:188). Because `distribute()` calls `notifyReward()` synchronously with no try/catch, the revert unwinds the **entire** transaction — including the burn leg (T:157) and the `reserve` accumulation (T:149), which have no dependency on the staking call succeeding. This is explicitly documented as accepted risk (T:137-140 dev comment) and is owner-only/self-inflicted (both `distribute` and the reward path are gated to trusted roles), recoverable by bundling into a larger call. Flagged at Low because it compounds with Finding 1: if the reward leg is ever *permanently* rather than just dust-sized broken, this synchronous coupling is the same freeze mechanism with no severity ceiling.

**Fix**: Minimum-amount guard in `distribute()` (e.g. `require(stakerAmount >= rewardDuration, "Tv2: dust")`), or wrap the `notifyReward` call in try/catch so burn/reserve legs settle independently of the staking leg's outcome.

---

[70] **3. `activateStaking()` has no dependency on `setTreasury()`/`setRegistry()` being set first**

`UnionStakingVaultV2.activateStaking()` lines 136-142 · Severity: **Low** · Confidence: 70 · Origin: **[both]** — Phase 1 `AccessControl-2`, `General-2`; Phase 2 access-control agent independently re-confirmed

**Description**: `activateStaking()`'s only guard is `require(!stakingActive)` (V:137). The three bootstrap calls (`setTreasury`, `setRegistry`, `activateStaking`) are fully order-independent — confirmed by the `trySpendCredit` dev comment itself (V:223-225: *"Staking is deliberately wired before activation in the production graph. An inactive vault must behave as an empty credit source..."*), indicating the loose ordering is intentional design, not an oversight. A vault can therefore be `stakingActive == true` with `treasury`/`registry` still `address(0)`: stakers can deposit and accrue reward/credit bookkeeping normally, but `notifyReward` (V:176, `onlyTreasury`) and `trySpendCredit`/`settleSpentCredit` (V:218/248, `onlyRegistry`) are unreachable until those roles are separately set. Fully recoverable — both setters remain callable post-activation, and `unstake()` never checks `treasury`/`registry`, so principal is always withdrawable. No fund-loss path; the risk is a confusing bootstrap state where an "active" vault appears to be earning rewards but isn't yet wired to receive them.

**Fix**: `require(treasury != address(0) && registry != address(0))` inside `activateStaking()`, making it the final, dependent bootstrap step — or explicitly document the intended ordering if the current flexibility is deliberate.

---

[60] **4. Treasury staker-leg (`distribute()`) has no balance-delta check on its own side**

`TreasuryRouterV2.distribute()` lines 150-156 · Severity: **Low** · Confidence: 60 · Origin: **[both]** — Phase 1 `ERC20-1`, `General-1`; Phase 2 unanimous confirmation across essentially all 12 agents

**Description**: Every other AZL transfer in both contracts (the burn leg via `_safeTransferExact`, both pull-sides in `UnionStakingVaultV2.stake`/`notifyReward`) is bracketed by an exact-balance-delta assertion that hard-reverts on any mismatch. The staker leg alone (`forceApprove` → `notifyReward` → `forceApprove(0)`, T:150-156) has none — it relies entirely on the callee's own verification. **Confirmed fully mitigated under the current deployed graph** by all 12 Phase-2 agents: `UnionStakingVaultV2.notifyReward()` performs the actual pull via `safeTransferFrom` with its own strict delta assertion (V:181-183), and `staking` cannot be repointed post-`configure()` (no setter exists) — so the dev comment's own "revisit if repointed" escape hatch doesn't actually apply; a hypothetical hostile `staking` target would require redeploying the whole Treasury, not just repointing an address. The residual exposure is confined to a deliberately-hostile bootstrap choice by the Treasury owner, already covered by Finding 1's broader bootstrap-trust discussion.

**Fix**: Add a symmetric delta check for defensive-depth consistency across the codebase, or correct the dev comment to state the risk is bootstrap-time trust rather than future-repointing risk (since repointing is structurally impossible).

---

[55] **5. Reward interval fully orphaned to `undistributedRewards` when the per-share `increment` rounds to zero**

`UnionStakingVaultV2._update()` lines 318-327 · Severity: **Low** · Confidence: 55 · Origin: **[phase1-only]** (Precision-1)

**Description**: When `emission * ACC < totalStaked` (ACC=1e27), `increment = (emission*ACC)/totalStaked` rounds to 0, so the entire interval's emission is diverted to `undistributedRewards`/`roundingDust` instead of streaming to active stakers. Verified theoretical-only: requires `totalStaked > ~7.7e23 AZL` for a realistic reward schedule — unreachable for any plausible token supply. Owner-recoverable via `rescueUndistributed()` even in the extreme case.

**Fix**: Optional hardening — when `increment == 0` but `emission > 0` and `totalStaked > 0`, carry the emission forward as a numerator remainder instead of advancing `lastUpdate` past it (mirroring the credit system's own remainder-carrying pattern).

---

[60] **6. Pooled-vault AZL frozen if AZL ever gains pause/blocklist behavior**

`UnionStakingVaultV2` (all AZL paths), `TreasuryRouterV2` (all AZL paths) · Severity: **Low** · Confidence: 60 · Origin: **[phase1-only]** (ERC20-2)

**Description**: Both contracts are shared-custody vaults holding all stakers'/all recorded revenue's AZL at a single address. If AZL were ever pausable or gained a blocklist and either contract's address were listed, every user's funds would be frozen simultaneously — the classic shared-vault blocklist exposure. Explicitly documented as a "standard AZL only" assumption (T:168); contingent entirely on AZL's own (out-of-scope) admin surface, not a code defect in these contracts.

**Fix**: No code change required if AZL is confirmed immutable/standard (as assumed). Document the trust assumption explicitly if not already tracked at the protocol level.

---

[65] **7. Reward-rate dilution from frequent `notifyReward` calls relative to `rewardDuration`**

`UnionStakingVaultV2.notifyReward()` lines 185-194 · Severity: **Low** · Confidence: 65 · Origin: **[phase1-only]** (Staking-2)

**Description**: The Synthetix-style tail-bundling (`remaining` from the prior unstreamed schedule folded into `scheduled`, `rewardFinish` reset to a full fresh `rewardDuration` on every call) can perpetually push value into the future if `distribute()`'s cadence is short relative to `rewardDuration`. A governance/cadence property, not third-party-triggerable (both `distribute` and `notifyReward` are gated to trusted roles) — value is delayed, not lost.

**Fix**: Consider decoupling the rate recalculation from a full-duration reset (e.g. only extend `rewardFinish` when adding beyond the current end), or document the intended `distribute()` cadence relative to `rewardDuration`.

---

[55] **8. `totalCreditsSpent` counter drifts upward on spend→settle-to-account→re-spend cycles**

`UnionStakingVaultV2.trySpendCredit()` line 232, `settleSpentCredit()` lines 248-264 · Severity: **Info** · Confidence: 55 · Origin: **[phase2-only]** — independently flagged by 6 of 12 blind attack agents (boundary, invariant, periphery, execution-trace, asymmetry, first-principles)

**Description**: `trySpendCredit` increments `totalCreditsSpent += CREDIT_UNIT` on every spend (V:232); `settleSpentCredit(taskId, from, to, isPost)` with `to != address(0)` re-banks the same `CREDIT_UNIT` to `to` (V:262) without ever decrementing `totalCreditsSpent`. A credit that is spent, then settled back to an account (rather than burned via `to == address(0)`), then re-spent, inflates `totalCreditsSpent` beyond real net consumption and potentially beyond `totalCreditsIssued`. **Unanimously confirmed non-exploitable by all 6 agents that flagged it**: `totalCreditsSpent` is a pure telemetry counter with zero role in any `require`/cap/solvency check — the actual `CREDIT_CAP` enforcement reads `totalCreditsIssued`, which this drift does not affect, and live spendable credit supply (`bankedCredits` + `outstandingTaskCredits`) stays correctly conserved throughout. Promoted to a reported Info-level finding given the unusually strong 6-agent independent corroboration, purely as an accounting-correctness note for any off-chain/integrator consumer that might treat `totalCreditsSpent` as a meaningful net-consumption figure.

**Fix**: Decrement `totalCreditsSpent` by `CREDIT_UNIT` in `settleSpentCredit` when `to != address(0)` (re-bank case), or rename/document the variable as "cumulative gross spends" rather than implying net consumption.

---

[70] **9. `distribute()` uses inline `require(msg.sender==owner())` instead of the `onlyOwner` modifier**

`TreasuryRouterV2.distribute()` line 142 · Severity: **Info** · Confidence: 70 · Origin: **[both]** — Phase 1 `AccessControl-5`, `General-3`

**Description**: Functionally identical to `onlyOwner` (verified against OZ's actual `_checkOwner()` — no `_msgSender()`/meta-tx divergence since neither contract overrides `Context`). Stylistic inconsistency only, flagged as a minor audit-readability hazard.

---

[65] **10. `validateGraph()` is advisory-only on both contracts; doesn't cover `bondVault`**

`TreasuryRouterV2.validateGraph()` lines 110-114, `UnionStakingVaultV2.validateGraph()` lines 144-148 · Severity: **Info** · Confidence: 65 · Origin: **[phase1-only]** (General-5)

**Description**: Nothing calls `validateGraph()` internally on either contract; nothing gates on it. The Treasury's version additionally never checks `bondVault`. Fails safe at runtime (a wrong link simply reverts `distribute`/`notifyReward`), but bootstrap correctness relies entirely on off-chain discipline — same root pattern as Finding 1.

---

[60] **11. No emergency pause on either AZL-custody contract**

`TreasuryRouterV2.sol`, `UnionStakingVaultV2.sol` (whole contracts) · Severity: **Info** · Confidence: 60 · Origin: **[phase1-only]** (AccessControl-3)

**Description**: Deliberate minimalism — no `Pausable`, no pause-abuse risk either. Noted for completeness given both contracts custody significant value.

---

[60] **12. `TaskScopeRegistryV2` has no owner and no correction mechanism**

`TaskScopeRegistryV2.sol` (whole contract) · Severity: **Info** · Confidence: 60 · Origin: **[phase1-only]** (AccessControl-4)

**Description**: Intentional "immutable publication" design (NatSpec: "Only the task poster... can publish, and only once", S:47-48) — a mistaken scope or a wrong `taskRegistry` address is permanently unfixable. No fund/authorization risk; the contract holds no value and grants no external privileges.

---

## Examined, No Issue

Traced adversarially by multiple Phase-2 agents and explicitly cleared:

- **Flash-loan reward/credit sniping (stake→notify→unstake or checkpoint, same block)** — unanimously and rigorously defeated across every agent that checked it (flashloans, defi-staking, flow-gap, math-precision, periphery, asymmetry). `_update()` runs before `stakeOf`/`totalStaked` mutate on both `stake()` and the credit-accrual path, and `until > lastUpdate` / `elapsed > 0` gates mean a same-block window accrues exactly zero, both for streamed rewards and for Action Credits.
- **`rescueSurplus`/`rescueUndistributed` front-running staker claims** — traced end-to-end: `totalRewardLiability` is only decremented when AZL physically leaves the contract (`claimPayout`, `_payOrDefer` success, `rescueUndistributed`), so deferred payouts, unclaimed `accrued`, and `undistributedRewards` all remain subsets of the liability the rescue guards protect. Owner cannot reach staker principal or owed rewards.
- **Treasury `_recordRevenue` solvency formula** (`unrecorded = balanceOf + distributedRevenue - recordedRevenue - reserve`) — verified algebraically invariant across every mutator; cannot record unfunded revenue, cannot underflow.
- **Credit-cap conservation** (I6/I7) — `Σ bankedCredits ≤ totalCreditsIssued ≤ CREDIT_CAP` traced through stake/unstake/spend/settle sequences including cap-close latching; `FullMath.mulDiv` + `mulmod` remainder-carrying verified correct, no overflow reachable for any realistic input.
- **`claimBondSlashPayout()` permissionless, no `nonReentrant`** — verified safe: inbound-pull-only, writes no Treasury state directly, and every function a re-entering `bondVault` could reach is independently role-gated to an unreachable caller.
- **No unbounded loops, no `selfdestruct`/`delegatecall`, no native-ETH accounting** anywhere in scope — unanimous across all 19 total agents (7 Phase 1 + 12 Phase 2).

---

## Access-Control Inventory

**21 external/public state-changing entrypoints (excl. inherited ownership) + 8 ownership functions across the 2 independently-`Ownable` contracts = 29 total, all inventoried.**

| Function | Guard | Caller | Moves value? |
|---|---|---|---|
| `TreasuryRouterV2.configure()` (88) | `onlyOwner` + one-shot | owner, once | no |
| `TreasuryRouterV2.configureBondVault()` (97) | `onlyOwner` + one-shot | owner, once | no |
| `TreasuryRouterV2.claimBondSlashPayout()` (105) | none | anyone | inbound only |
| `TreasuryRouterV2.recordRevenue()` (116) | `onlyVault` + `nonReentrant` | vault (job 551) | no |
| `TreasuryRouterV2.recordBondSlashRevenue()` (120) | `onlyBondVault` + `nonReentrant` | bondVault | no |
| `TreasuryRouterV2.distribute()` (141) | inline owner check + `nonReentrant` | owner | yes |
| `TreasuryRouterV2.withdrawReserve()` (161) | `onlyOwner` + `nonReentrant` | owner | yes |
| `TaskScopeRegistryV2.publish()` (60) | self-scoped (external lookup) + one-shot | task's recorded poster | no |
| `UnionStakingVaultV2.setTreasury()` (124) | `onlyOwner` + one-shot | owner, once | no |
| `UnionStakingVaultV2.setRegistry()` (130) | `onlyOwner` + one-shot | owner, once | no |
| `UnionStakingVaultV2.activateStaking()` (136) | `onlyOwner` + one-shot | owner, once | no |
| `UnionStakingVaultV2.stake()` (150) | self-scoped + `nonReentrant` | anyone (once active) | yes |
| `UnionStakingVaultV2.unstake()` (165) | self-scoped + `nonReentrant` | any staker | yes |
| `UnionStakingVaultV2.notifyReward()` (176) | `onlyTreasury` + `nonReentrant` | treasury | yes |
| `UnionStakingVaultV2.checkpoint()` (201) | none | anyone | no |
| `UnionStakingVaultV2.bankCredits()` (213) | self-scoped + `nonReentrant` | anyone (once active) | no |
| `UnionStakingVaultV2.trySpendCredit()` (218) | `onlyRegistry` | registry | no |
| `UnionStakingVaultV2.settleSpentCredit()` (248) | `onlyRegistry` | registry | no |
| `UnionStakingVaultV2.claim()` (267) | self-scoped + `nonReentrant` | any staker | yes |
| `UnionStakingVaultV2.claimPayout()` (276) | self-scoped + `nonReentrant` | any account | yes |
| `UnionStakingVaultV2.rescueUndistributed()` (288) | `onlyOwner` + `nonReentrant` | owner | yes |
| `UnionStakingVaultV2.rescueSurplus()` (298) | `onlyOwner` + `nonReentrant` | owner | yes |

`TreasuryRouterV2` and `UnionStakingVaultV2` each carry their **own, independent** `V2Ownable2Step` owner (2-step transfer, `renounceOwnership` hard-disabled, `cancelOwnershipTransfer` available) — nothing on-chain forces them to be the same address. `TaskScopeRegistryV2` has no owner at all.

**Unguarded entrypoints**: `stake`, `unstake`, `claim`, `claimPayout`, `bankCredits` (all self-scoped to caller's own position), `checkpoint` (global accounting poke, no per-account effect), `claimBondSlashPayout` (inbound-only pull trigger), `publish` (self-scoped via external `taskRegistry` lookup).

---

## Threat Model

| Actor | Reach | Resolution |
|---|---|---|
| Any caller (self) | `stake`/`unstake`/`claim`/`claimPayout`/`bankCredits` | invariant holds — self-scoping verified |
| Any caller | `checkpoint()`, `claimBondSlashPayout()`, `publish()` | invariant holds — no per-account or extraction effect |
| vault (job 551, trusted) | `recordRevenue()` | invariant holds — solvency check bounds |
| bondVault (trusted) | `recordBondSlashRevenue()`, pull target | invariant holds — same solvency check |
| Treasury owner | `distribute()` | Finding 2, 4, 9 |
| Treasury owner | `withdrawReserve()`, `configure()`/`configureBondVault()` | Finding 1, 10 |
| treasury addr | `notifyReward()` | Finding 2, 7 |
| registry (trusted, out-of-scope) | `trySpendCredit()`/`settleSpentCredit()` | Finding 8; otherwise invariant holds |
| Staking owner | `setTreasury()`/`setRegistry()`/`activateStaking()` | Finding 1, 3, 10 |
| Staking owner | `rescueUndistributed()`/`rescueSurplus()` | invariant holds — traced airtight against staker principal/rewards |
| staking target (hypothetical hostile repoint) | Treasury's `distribute()` allowance | Finding 4 — structurally impossible given no repoint mechanism |

---

## Leads

_All findings above cleared the confidence-50 floor. No item was demoted to a bare lead — every genuine code-level observation from both phases either promoted to a reported finding or was traced to a fully-cleared, non-issue conclusion documented in "Examined, No Issue" above._

---

> ⚠️ This review was performed by an autonomous AI audit pipeline (three-phase: context mapping → ethskills breadth → pashov-methodology depth, with cross-phase reconciliation). AI analysis can never verify the complete absence of vulnerabilities and no guarantee of security is given. Independent human review, a bug bounty program, and on-chain monitoring are strongly recommended before/alongside mainnet reliance on this subsystem.

////

# Security Review — AZZLE.ORG V2 Arbitration / Bond Vault / Treasury Router

**Audit target (pinned):** Base mainnet (chain 8453), verified source (Sourcify, exact match)

| Contract | Address | Fully qualified name |
|---|---|---|
| `ArbitrationModuleV2` | `0x2501988000Df2CF1c98c14d33113DF5Dc1a4DC90` | `src/v2/ArbitrationModuleV2.sol:ArbitrationModuleV2` |
| `VerifierBondVaultV2` | `0xF3b9b03BEF4C35ACc94AE39fc5A8D0AAB4BC904A` | `src/v2/VerifierBondVaultV2.sol:VerifierBondVaultV2` |
| `TreasuryRouterV2` | `0xa64E6Cf8F01C56c905EcAA978C4B4388090dCbf5` | `src/v2/TreasuryRouterV2.sol:TreasuryRouterV2` |

Base contract `src/v2/access/V2Ownable2Step.sol`. Compiler `0.8.24+commit.e11b9ed9`. Sources pulled from
Sourcify's v2 API (`exact_match`/`runtime_match`) for all three contracts; cross-confirmed against
BaseScan verification status. No repo/commit hash applies — this is on-chain verified source, not a
git checkout.

**Out of scope** (referenced only via interface, not audited): `registry` (`ITaskRegistryArbitrationV2`),
`escrow` (`IEscrowArbitrationV2`), `reputation` (`IReputationArbitrationV2`), `staking` (`IStakingV2`),
the `vault` revenue source, and the `azl` ERC20 token itself. All are treated as trusted black boxes per
the wiring checks these contracts perform at deploy/configure time.

**Methodology:** three-phase audit — Phase 0 context (protocol map + access-control inventory + threat
catalog, opus), Phase 1 breadth (5 ethskills domains: general, precision-math, erc20, access-control,
dos — opus), Phase 2 depth (12 pashov attack agents, blind to Phase 1 — opus), Phase 3 hybrid
reconciliation (this document). Scope sized "large" (≈700 in-scope LOC across 4 files excluding banner
art) per the methodology's LOC threshold, hence opus for both hunting phases.

---

## Scope

| | |
|---|---|
| **Mode** | Full scope — all 4 in-scope `.sol` files |
| **Files reviewed** | `ArbitrationModuleV2.sol` · `VerifierBondVaultV2.sol`<br>`TreasuryRouterV2.sol` · `access/V2Ownable2Step.sol` |
| **Confidence threshold** | 50 (findings below this are listed under Leads, not scored as findings) |

---

## Reconciliation Summary

- **Overlap** (found independently in both phases): 4 — panel-array unbounded growth, `_panelExitStatus`
  fail-open degradation, last-eligible-member liveness lock, `assignArbitrator` dead-code/broken window
  (this last one found by 1 of 5 Phase-1 agents and 7 of 12 Phase-2 agents — the single strongest
  cross-validated finding in this audit).
- **Phase-1-only**: 7 — `distribute()` staking-leg delta-verification gap (severity-disputed across
  Phase-1 domains, resolved below), `assignArbitrator` RULING-branch analysis, non-rotatable
  dependencies, `burnRecipient` no-setter, no timelock/multisig, `distribute()` rounding-dust direction,
  cosmetic access-style inconsistency.
- **Phase-2-only**: 5 — caller-controlled arbitrator/dispute pairing in `assignArbitrator`, owner
  exclusion-steering via `removePanelMember`, unrecoverable bond-lock if the registry rejects MUTUAL,
  `recordBondSlashRevenue` bootstrap-liveness gap, arbitrator self-dodge via withdrawal-toggling,
  timeout's fixed slash cap vs. escrow-value economics.
- **Re-examined leads kept**: 3 (promoted from single/dual-agent Phase-2 leads to findings on
  concrete-proof + multi-agent-corroboration grounds) · **demoted**: 0.
- **Coverage holes closed this pass**: 0 (both phases' fan-out already covered every privileged/
  value-moving entrypoint and every threat-catalog row — see Coverage Gate below).
- **Confidence floor used**: 50. Nothing fell below it after Phase 3 re-examination; two items
  remain as unscored Leads because they depend on out-of-scope contract behavior this audit cannot
  verify (registry/escrow/reputation/staking internals).

---

## Access-Control Inventory

*(Every `external`/`public` function in scope; roles; unguarded list. Full per-line-cite version is
in the Phase-0 protocol map; this table is the client-facing summary, cross-checked against the live
source during Phase 3.)*

| Contract.function | Guard | Caller |
|---|---|---|
| AM.`addPanelMember` | `onlyOwner` | owner |
| AM.`removePanelMember` | `onlyOwner` + invariant checks | owner |
| AM.`openDispute` | `onlyRegistry` | registry |
| AM.`assignArbitrator` | none (permissionless) | anyone |
| AM.`submitEvidence` | body: poster/worker | poster or worker |
| AM.`beginRuling` | none (permissionless) | anyone |
| AM.`rule` | body: `msg.sender==d.arbitrator` | assigned arbitrator |
| AM.`timeout` | none (permissionless) | anyone |
| VBV.`configureArbitration` | `onlyOwner`, one-shot | owner |
| VBV.`bond` | none (self-scoped) | anyone |
| VBV.`scheduleWithdrawal` | none (self-scoped + guard) | anyone |
| VBV.`withdraw` | none (self-scoped + guard) | anyone |
| VBV.`assign`/`release`/`slashAndRelease` | `onlyArbitration` | arbitration module |
| VBV.`claimPayout` | body: scoped to `pendingPayouts[msg.sender]` | anyone with a balance |
| TR.`configure`/`configureBondVault` | `onlyOwner`, one-shot each | owner |
| TR.`claimBondSlashPayout` | none (permissionless) | anyone |
| TR.`recordRevenue` | `onlyVault` | vault |
| TR.`recordBondSlashRevenue` | `onlyBondVault` | bond vault |
| TR.`distribute` | body: `msg.sender==owner()` | owner |
| TR.`withdrawReserve` | `onlyOwner` | owner |

**Roles**: each contract has its own independent `V2Ownable2Step` owner (2-step transfer,
`renounceOwnership` permanently disabled). `registry`/`escrow`/`reputation`/`bonds`/`treasury` (AM) are
`immutable`. `arbitration` (VBV), `vault`/`staking`/`bondVault` (TR) are write-once via one-shot
`configure*` with no rotation path. Panel membership (AM `authorized[]`/`panel[]`) is owner grant/revoke
only, index-preserving (no swap-pop).

**Entrypoint count**: 26 external/public state-changing functions across the four files, all present
above or in the Phase-0 full inventory; every one maps to ≥1 finding or threat-catalog row below.

---

## Threat Model

| Actor | Reaches | Could gain | Status |
|---|---|---|---|
| Any caller | `assignArbitrator` (ordering) | Choose which pending dispute draws which upcoming arbitrator | **Addressed by Finding #2** |
| AM owner | `removePanelMember` (exclusion) | Steer arbitrator selection after evidence is public | **Addressed by Finding #3** |
| Any caller | `timeout` when registry rejects MUTUAL | Permanently lock a dispute + arbitrator's bond | **Addressed by Finding #1** |
| Any caller | `assignArbitrator` (window) | N/A — this is a liveness failure, not an attacker gain | **Addressed by Finding #4** |
| Anyone | `slashAndRelease`→`recordBondSlashRevenue` during bootstrap | Block a slash-bearing settlement | **Addressed by Finding #5** |
| Arbitrator (self) | `scheduleWithdrawal`+`bond` toggle | Dodge an unfavorable draw, shift risk to peers | **Addressed by Finding #6** |
| Poster + negligent/colluding arbitrator | `timeout` economics | Reclaim full escrow for less than its value in bribe | **Addressed by Finding #7** |
| Owner (bloat) | `addPanelMember`/`removePanelMember` churn | Degrade gas cost of `openDispute`/withdrawals over time | **Addressed by Finding #8** |
| Any caller | `staking.notifyReward` under-pull in `distribute` | Strand funds, corrupt `distributedRevenue` accounting | **Addressed by Finding #9** |
| Verifier | `_panelExitStatus` staticcall failure | Bypass last-eligible-member guard if `arbitration` misbehaves | Invariant holds — `arbitration` is trusted/write-once; **noted as Finding #10 (robustness only)** |
| Sole eligible verifier | `scheduleWithdrawal`/`withdraw` | N/A — self-affecting liveness trap | **Addressed by Finding #11** |
| Compromised owner | any owner-gated function | Instant, non-timelocked action | Accepted trust boundary — **noted under Low findings (#12-14)** |
| Registry/escrow/reputation/staking (out-of-scope, trusted) | feed every settlement/distribution decision | Full trust boundary | Invariant holds by design — black-box trust is the accepted model |

---

## Findings

Ordered by severity. Origin tag: `[phase1]`, `[phase2]`, or `[both]`.

---

[90] **1. `timeout`/`_settle` can become permanently unsettleable if the registry ever rejects the hardcoded MUTUAL outcome — the assigned arbitrator's entire bond locks forever with no recovery path**

`ArbitrationModuleV2.timeout` / `ArbitrationModuleV2._settle` · Confidence: 90 · **[phase2]**

**Description**
`timeout()` (`ArbitrationModuleV2.sol:276-301`) always settles via `_settle(d, Outcome.MUTUAL, 0, ...)`
with no alternative outcome. `_settle` (`:305-328`) gates on a 4-way preflight including
`registry.canResolveDispute(d.taskId, uint8(outcome))` (`:311`). If the trusted-but-out-of-scope
`registry` legitimately refuses to accept a MUTUAL resolution for a specific task (e.g. because it gates
resolution on delivery status), this `require` fails every time, forever — `outcome` and the registry's
verdict cannot change via any in-scope call. Because `VerifierBondVaultV2.activeAssignments[verifier]`
is decremented *only* inside `release()`/`slashAndRelease()` (`VerifierBondVaultV2.sol:169-174`,
`176-190`), both reachable *only* via a successful `_settle`, and `scheduleWithdrawal`/`withdraw` both
require `activeAssignments[msg.sender]==0` (`:123`, `:135`), the assigned arbitrator's entire bond — not
just the reserved slice — is frozen permanently, and the underlying escrow stays frozen too. `rule` is
not an alternative once `block.timestamp > d.rulingDeadline` (`:266`).

```
// ArbitrationModuleV2.sol:305-317
function _settle(Dispute storage d, Outcome outcome, uint16 workerBps, bool slashAssignment, uint256 slashAmount) internal {
    ...
    require(
        escrow.canSettle(d.taskId) && registry.canResolveDispute(d.taskId, uint8(outcome))
            && reputation.canRecordDispute(d.taskId, winner, loser, neutral)
            && (d.arbitrator == address(0) || bonds.canRelease(d.arbitrator)),
        "AMv2: settlement preflight"
    );
```

**Fix**

```diff
- function timeout(uint256 taskId) external nonReentrant {
-     ...
-     _settle(d, Outcome.MUTUAL, workerBps, assigned, amount);
-     if (amount > 0) emit ArbitratorSlashed(taskId, d.arbitrator, amount);
- }
+ // Give timeout a settlement path that does not require the registry to accept
+ // a specific outcome — e.g. an unconditional bond-side release independent of
+ // registry.resolveDispute/canResolveDispute succeeding, so a dispute the
+ // registry refuses to close via MUTUAL still frees the arbitrator's bond.
```

---

[85] **2. `assignArbitrator` lets a permissionless caller choose which pending dispute consumes the next round-robin slot — arbitrator-to-dispute pairing is caller-controlled, not protocol-determined**

`ArbitrationModuleV2.assignArbitrator` / `_nextArbitrator` · Confidence: 85 · **[phase2]**

**Description**
`assignmentCursor` is one shared, monotonically-advancing pointer (`ArbitrationModuleV2.sol:106`).
`assignArbitrator(taskId)` (`:225-241`) accepts a caller-chosen `taskId` and, when called, consumes the
*next* rotation slot for *that specific dispute*. With ≥2 disputes simultaneously unassigned — a cheap,
realistic precondition (a small panel, or any panel where members hold close to `minimumBond` so a
single active assignment exhausts eligibility, per `VerifierBondVaultV2.isEligible`,
`VerifierBondVaultV2.sol:151-154`) — the caller decides the *order* in which pending disputes draw from
the rotation, and therefore decides which dispute lands which upcoming arbitrator. Concretely: panel
`[X,Y]`, cursor `0`, disputes D1 and D2 both open unassigned. Calling `assignArbitrator(D2)` first gives
D2 arbitrator X (cursor→1); calling `assignArbitrator(D1)` first gives D1 arbitrator X instead. This
generalizes to any N pending disputes against the next N rotation slots — directly defeating the
contract's own documented design goal ("No owner can pick an arbitrator after seeing case evidence",
`ArbitrationModuleV2.sol:77`) since here *any* party can steer selection, not just the owner, once
evidence (and case merits) are visible.

```solidity
// ArbitrationModuleV2.sol:225-236
function assignArbitrator(uint256 taskId) external nonReentrant returns (address arbitrator) {
    Dispute storage d = disputes[taskId];
    require(d.arbitrator == address(0), "AMv2: assigned");
    ...
    (address poster, address worker) = registry.taskParties(taskId);
    arbitrator = _nextArbitrator(poster, worker);
    require(arbitrator != address(0), "AMv2: no bonded panel");
    d.arbitrator = arbitrator;
    bonds.assign(arbitrator);
```

**Fix**

```diff
- // caller supplies an arbitrary taskId, controlling consumption order of the shared cursor
+ // Process the oldest unassigned dispute first (FIFO over a tracked pending-assignment
+ // queue) instead of accepting an arbitrary caller-chosen taskId, so the calling order
+ // cannot influence which dispute receives which arbitrator.
```

---

[80] **3. `removePanelMember` lets the owner defeat "no post-hoc arbitrator selection" by excluding the next-in-rotation member after evidence is public**

`ArbitrationModuleV2.removePanelMember` / `_nextArbitrator` · Confidence: 80 · **[phase2]**

**Description**
The zero-slot (not swap-pop) design at `ArbitrationModuleV2.sol:161-167` defends against *reindexing*
steering (an owner sliding a chosen member into the next slot), per its own comment:

```solidity
// ArbitrationModuleV2.sol:161-167
uint256 length = panel.length;
for (uint256 i; i < length; ++i) {
    if (panel[i] != member) continue;
    // Keep the index stable. Swap-and-pop would let governance move
    // a chosen member into the next round-robin slot after seeing a case.
    panel[i] = address(0);
```

...but it does *not* defend against *exclusion* steering: the owner can still null the specific slot the
cursor would otherwise select, forcing the scan onto the next candidate. Concretely: panel
`[Alice(0),Bob(1),Carol(2)]`, cursor=1. Dispute T opens at full capacity; during T's evidence window Bob
and Carol both free up (Alice stays busy). `_nextArbitrator` from index 1 would pick Bob. Owner calls
`removePanelMember(Bob)` — passes every guard (`authorized[Bob]` true, `!bonds.canRelease(Bob)` true,
`_hasEligiblePanelMemberExcluding(Bob)` true since Carol is eligible) — Bob's slot is nulled.
`assignArbitrator(T)` now selects Carol instead. The owner picked T's arbitrator *after* evidence was
public; they can re-`addPanelMember(Bob)` afterward to restore the panel.

**Fix**

```diff
- function removePanelMember(address member) external onlyOwner {
-     // no check for whether a dispute is currently awaiting assignment
+ function removePanelMember(address member) external onlyOwner {
+     // Freeze removals that could change the outcome of a dispute currently
+     // awaiting assignment (arbitrator==0, still within its assignment window),
+     // or snapshot the eligible-candidate set at openDispute time and assign
+     // strictly from that snapshot regardless of later panel edits.
```

---

[70] **4. `assignArbitrator`'s assignment window silently collapses to evidence-phase-only — dead RULING branch, capacity-starved disputes forced into an unadjudicated, no-slash timeout**

`ArbitrationModuleV2.assignArbitrator` · Confidence: 70 · **[both]** — found independently by 1 of 5
Phase-1 agents and 7 of 12 Phase-2 agents (math-precision, invariant, periphery [original FINDING],
first-principles, asymmetry, boundary, flow-gap). The single most cross-corroborated result in this audit.

**Description**

```solidity
// ArbitrationModuleV2.sol:227-238
uint256 resolutionDeadline = uint256(d.evidenceDeadline) + rulingWindow;
bool assignable = (d.status == Status.EVIDENCE || d.status == Status.RULING)
    && block.timestamp + rulingWindow <= resolutionDeadline;
require(assignable, "AMv2: assignment window");
...
if (d.status == Status.RULING) {
    d.rulingDeadline = uint64(block.timestamp) + rulingWindow;
}
```

`block.timestamp + rulingWindow <= evidenceDeadline + rulingWindow` algebraically reduces to
`block.timestamp <= evidenceDeadline` (the `rulingWindow` term cancels on both sides). `Status.RULING`
is only reachable via `beginRuling()` (`:252-258`), which itself requires `block.timestamp >
evidenceDeadline`. The two conditions are mutually exclusive, so the `if (status==RULING)` branch is
dead code, and the fallback can only ever fire during the evidence window — contradicting its own
NatSpec ("assigns bond before ruling phase deadlines elapse", `:224-226`). Concretely: panel fully
occupied when a dispute opens (`arbitrator==0`); no capacity frees before `evidenceDeadline`; evidence
window lapses; `beginRuling` moves status to RULING. `assignArbitrator` now always reverts
`"AMv2: assignment window"`. The dispute's only exit is `timeout` → `Outcome.MUTUAL`, `workerBps=0`, no
slash (unassigned) — a full refund to the poster regardless of whether the worker actually delivered.

**Fix**

```diff
- bool assignable = (d.status == Status.EVIDENCE || d.status == Status.RULING)
-     && block.timestamp + rulingWindow <= resolutionDeadline;
+ bool assignable = (d.status == Status.EVIDENCE || d.status == Status.RULING)
+     && block.timestamp <= resolutionDeadline;
```

---

[65] **5. `slashAndRelease`'s revenue-recording callback has no failure-tolerant fallback — an unconfigured `bondVault` link blocks every slash-bearing settlement**

`VerifierBondVaultV2.slashAndRelease` / `TreasuryRouterV2.recordBondSlashRevenue` · Confidence: 65 ·
**[phase2]** — found independently by 4 of 12 Phase-2 agents (access-control, economic-security,
asymmetry, flow-gap).

**Description**
`_payOrDefer` exists specifically so a *token-transfer* failure never blocks a slash — it defers to
`pendingPayouts` instead of reverting. The very next call has no equivalent tolerance:

```solidity
// VerifierBondVaultV2.sol:184-186
if (_payOrDefer(treasury, amount)) {
    ITreasuryBondRevenueV2(treasury).recordBondSlashRevenue(amount);
}
```

`recordBondSlashRevenue` is `onlyBondVault` (`TreasuryRouterV2.sol:120`), and `bondVault` starts
`address(0)`, set only via the one-shot `configureBondVault` (`:97-101`). In the bootstrap window between
`VBV.configureArbitration(AM)` (which makes disputes/assignments live) and `TR.configureBondVault(VBV)`
(the documented final wiring step), a dispute can be opened, assigned, and time out with a slash — but
the `recordBondSlashRevenue` call reverts, reverting the entire `timeout`. Unlike Finding #1, this is
self-healing per-dispute: once `configureBondVault` completes, a retried `timeout` on the same dispute
succeeds. But this audit cannot confirm from in-scope code alone whether deployment tooling guarantees
`configureBondVault` runs before any dispute can reach a slash-eligible timeout.

**Fix**

```diff
  if (_payOrDefer(treasury, amount)) {
-     ITreasuryBondRevenueV2(treasury).recordBondSlashRevenue(amount);
+     try ITreasuryBondRevenueV2(treasury).recordBondSlashRevenue(amount) {} catch {
+         // route to the same deferred-accounting path used when the transfer itself fails
+     }
  }
```

---

[55] **6. `distribute()`'s staking leg has no balance-delta verification — under-consumption by `staking` strands funds and corrupts `distributedRevenue` accounting**

`TreasuryRouterV2.distribute` · Confidence: 55 · **[phase1]** — raised at Medium by the erc20-domain
agent and at Info by the general-domain agent; independently examined and found structurally sound
*under the normal-operation assumption* by 2 Phase-2 agents (asymmetry confirmed `unrecorded` is
delta-invariant across `distribute`; numerical-gap explicitly classified it as accepted-risk and did not
re-raise it as a finding). Phase 3 resolves the severity at Medium: the accounting-corruption mechanism
below is real and concrete, even though the code's own author already flagged the underlying assumption
as an accepted trade-off.

**Description**
Every other AZL transfer site in scope (`bond`, `withdraw`, `claimPayout`, the burn leg, reserve
withdrawal, even the deferred `_payOrDefer`) verifies an exact balance delta. The staking leg is the sole
exception:

```solidity
// TreasuryRouterV2.sol:145,150-156
distributedRevenue += amount;
...
azl.forceApprove(staking, stakerAmount);
/// @dev Accepted Risk (deliberate trade-off): ... no balance-delta verification ...
IStakingV2(staking).notifyReward(stakerAmount);
azl.forceApprove(staking, 0);
```

`distributedRevenue` books the full `amount` (including `stakerAmount`) *before* the pull. If
`staking.notifyReward` pulls less than `stakerAmount` without reverting, the shortfall physically stays
in the treasury but is booked as already-distributed — permanently unreachable via
`distributableRevenue()` and not credited to `reserve`. It later resurfaces incorrectly: the orphaned
balance inflates `azl.balanceOf(this)`, which lets a *subsequent, unrelated* `_recordRevenue` call
(`TreasuryRouterV2.sol:125-131`) record more "revenue" than was actually freshly delivered, silently
reassigning stranded funds as backing for someone else's revenue event.

**Fix**

```diff
  azl.forceApprove(staking, stakerAmount);
+ uint256 beforeBal = azl.balanceOf(address(this));
  IStakingV2(staking).notifyReward(stakerAmount);
  azl.forceApprove(staking, 0);
+ require(beforeBal - azl.balanceOf(address(this)) == stakerAmount, "Tv2: staker leg delta");
```

---

[50] **7. Panel members can dodge unfavorable dispute assignments by toggling withdrawal-eligibility, shifting slash-risk onto other members**

`VerifierBondVaultV2.scheduleWithdrawal` / `bond` · Confidence: 50 · **[phase2]** — found independently
by 2 of 12 Phase-2 agents (first-principles, trust-gap).

**Description**
`scheduleWithdrawal` immediately flips `isEligible(member)` to `false` via `withdrawReadyAt != 0`
(`VerifierBondVaultV2.sol:151-154`), causing `_nextArbitrator` to skip that member; `bond(1)`
immediately `delete withdrawReadyAt[msg.sender]` (`:116`), restoring eligibility. `assignmentCursor` and
`panel` are both public, so a member can predict roughly when they're next in line and, on observing an
incoming assignment they'd rather dodge, front-run with `scheduleWithdrawal()` (cheap: only requires
`activeAssignments==0`, true before assignment, and passes the last-eligible-member guard as long as one
other member is eligible), get skipped, then `bond(1)` to restore eligibility for future disputes.

**Fix**
Add a cooldown or cost to eligibility-toggling (e.g. a minimum re-eligibility delay after
`withdrawReadyAt` is cleared, or a round-robin priority penalty for members who recently toggled), so
determinism can't be gamed at negligible cost.

---

### Low severity

**8. Unbounded, never-shrinking `panel` array linearly scanned on hot/critical paths** — `[both]`.
`ArbitrationModuleV2._nextArbitrator`/`_hasEligiblePanelMemberExcluding` (`:341-359`, `:187-194`) scan
the full `panel` array including permanent holes left by `removePanelMember`'s slot-nulling (`:161-167`,
deliberate, to keep round-robin indices stable). `panel.length` only ever grows (re-adding pushes a new
slot rather than reusing a hole). Owner-gated only (not third-party-triggerable); realistic churn (~1,000
dead slots over a contract's life) adds meaningful gas to every `openDispute` and, worse, to
`VerifierBondVaultV2.scheduleWithdrawal`/`withdraw` via the `_panelExitStatus` staticcall (which forwards
63/64 gas), potentially causing honest-verifier exits to fail out-of-gas. *Fix*: reuse holes on re-add or
track live members in a compact structure.

**9. Last eligible panel member's bond can become permanently unwithdrawable and unremovable** —
`[both]`. `VerifierBondVaultV2.scheduleWithdrawal`/`withdraw` and `ArbitrationModuleV2.removePanelMember`
all revert for the sole eligible member; resolution requires an unrelated third party to bond up another
member first. Deliberate design (guarantees ≥1 live arbitrator) but an unbounded liveness trap for that
member's funds. *Fix*: an owner-gated escape hatch for explicit empty-panel acceptance.

**10. `TreasuryRouterV2.burnRecipient` is mutable-typed but has no setter** — `[phase1]`. Declared plain
`address public`, not `immutable`, but written only in the constructor. 40% of all distributed revenue
routes there permanently; a wrong constructor arg is uncorrectable (no setter, `renounceOwnership`
disabled). *Fix*: declare `immutable`, or add a guarded setter.

**11. No timelock or multisig on immediate-effect owner actions** — `[phase1]`, related to Finding #3
above (the concrete exploit of this general gap). `addPanelMember`/`removePanelMember`,
`distribute`/`withdrawReserve`, and all one-shot `configure*` execute instantly. *Fix*: route ownership
through a multisig; timelock panel changes and `withdrawReserve`.

**12. Wired external dependencies are permanently non-rotatable with no pause/revoke path** —
`[phase1]`. `registry`/`escrow`/`reputation`/`bonds`/`treasury` (immutable, AM) and
`arbitration`/`vault`/`staking`/`bondVault` (write-once) have no rotation or emergency-pause mechanism.
Deliberate anti-rug hardening, but a bug later found in any wired dependency cannot be contained.

**13. `timeout`'s fixed slash cap does not scale with disputed escrow value** — `[phase2]`. The poster is
refunded 100% on timeout while the arbitrator's downside is capped at a protocol-wide constant unrelated
to the specific task's value; for high-value tasks this can make stalling economically dominant over an
honest ruling for a colluding/negligent arbitrator + poster pair. Partially accepted-risk per the code's
own reputation-signal mitigation comment. *Fix*: scale the cap with escrow value, or make timeout less
than a full refund.

**14. `VerifierBondVaultV2._panelExitStatus` staticcalls silently degrade to `false` on failure** —
`[both]`. Asymmetric failure handling on the last-eligible-member guard's two staticcalls; not
exploitable against the trusted, write-once `arbitration` target as currently wired, but fragile if that
trust assumption ever weakens. *Fix*: fail closed (`require(ok && data.length==32)`) on the
membership-check leg.

---

## Leads

_Vulnerability trails with concrete code smells where the full exploit path could not be completed in
one analysis pass, or which depend on out-of-scope contract behavior this audit cannot verify. Not
scored._

- **Registry party-identity re-read consistency** — `ArbitrationModuleV2._settle` — Code smells:
  `registry.taskParties(taskId)` is re-read live at every touch point (`openDispute`, `assignArbitrator`,
  `submitEvidence`, `timeout`, `_settle`) with no caching or re-verification that the assigned arbitrator
  is still neither party by settlement time — depends entirely on trusted, out-of-scope registry
  behavior; no in-scope mechanism to construct a concrete exploit.
- **Owner reciprocal-check asymmetry** — `TreasuryRouterV2.configure`/`configureBondVault` — Code
  smells: `configureArbitration` (VBV) enforces a reciprocal handshake before accepting a wiring
  target; the router's `configure`/`configureBondVault` do not. Owner-gated misconfiguration risk only,
  not attacker-triggerable.
- **`scheduleWithdrawal` missing `nonReentrant`** — `VerifierBondVaultV2.scheduleWithdrawal` — Code
  smells: the only VBV state-changing function without the guard; currently safe because it only makes
  staticcalls, contingent on `azl` never gaining a transfer hook.
- **Dead/vestigial accounting** — `ArbitrationModuleV2.timeout` (`d.slashed`, always 0 at read time given
  SETTLED is terminal), `require(cap<=bonds.assignmentReserve())` (tautological given
  `assignmentReserve==minimumBond`), `VerifierBondVaultV2.claimPayout`'s non-treasury-recipient branch
  (unreachable — only `treasury` ever accrues `pendingPayouts`), `validateGraph()` on both AM and TR
  (returns `bool` but can only ever revert-or-true; never enforced by any state-changing path, confirmed
  fail-safe without it). No security impact; code-cleanliness only.
- **`timeout` emits ambiguous `Ruled` event / extra reputation signal** — `ArbitrationModuleV2.timeout` —
  Code smells: a timed-out MUTUAL settlement emits the identical `Ruled` event a genuine arbitrator
  MUTUAL ruling would, plus an extra `reputation.recordUnresolvedDispute` write — off-chain consumers
  cannot distinguish adjudication from stalling without out-of-scope reputation-contract semantics.

---

## Coverage Gate

`Entrypoints: 26 external/public state-changing functions in source, 26 in inventory.`
Every privileged/value-moving entrypoint above maps to ≥1 finding, threat-catalog row, or an explicit
"examined, no issue" note from at least one hunting-phase agent (verified during Phase 3 against both
raw reports). Every documented invariant (I1–I14 in the Phase-0 map) names its maintaining function(s)
and was independently attacked by ≥3 Phase-2 agents; none were falsified except I1 (round-robin-only
selection, defeated two ways — Findings #2 and #3) and the liveness half of I2/I12 (settlement can wedge
— Finding #1). `Coverage: 14 threat-catalog rows, 14 answered. Holes closed this pass: 0.`

---

## Findings List

| # | Confidence | Severity | Title |
|---|---|---|---|
| 1 | [90] | High | `timeout`/`_settle` unrecoverable bond-lock if registry rejects MUTUAL |
| 2 | [85] | High | `assignArbitrator` caller-controlled dispute↔arbitrator pairing |
| 3 | [80] | Medium | `removePanelMember` owner post-hoc arbitrator-selection steering |
| 4 | [70] | Medium | `assignArbitrator` dead RULING branch / evidence-only window |
| 5 | [65] | Medium | `slashAndRelease`→`recordBondSlashRevenue` bootstrap-liveness gap |
| 6 | [55] | Medium | `distribute()` staking-leg missing delta verification |
| 7 | [50] | Low | Arbitrator self-dodge via withdrawal-eligibility toggling |
| 8 | — | Low | Unbounded `panel` array — gas-growth DoS |
| 9 | — | Low | Last eligible member bond-withdrawal liveness trap |
| 10 | — | Low | `burnRecipient` mutable but setterless |
| 11 | — | Low | No timelock/multisig on owner actions |
| 12 | — | Low | Non-rotatable wired dependencies, no pause |
| 13 | — | Low | `timeout` fixed slash cap vs. escrow-value economics |
| 14 | — | Low | `_panelExitStatus` fail-open staticcall degradation |

---

> ⚠️ This review was performed by an autonomous AI audit pipeline (three-phase: context building,
> ethskills breadth, pashov-methodology depth, hybrid reconciliation). AI analysis can never verify the
> complete absence of vulnerabilities and no guarantee of security is given. Independent human review,
> a public bug bounty, and on-chain monitoring are strongly recommended before or alongside relying on
> this system to hold user funds — particularly given Findings #1–#3, which affect the core
> "deterministic, unbiased arbitration" guarantee this system is built around.
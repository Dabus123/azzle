# Failure Mode Analysis

## Contract Bugs

**Impact:** Fund loss, incorrect state transitions.

**Detection:** Audits, formal verification, invariant tests.

**Recovery:** Pause via social coordination; deploy fixed registry; migrate via client address updates. No admin key in immutable deployment.

## XMTP Network Outage

**Impact:** Negotiation stalled; settlement may proceed if terms already Onchain.

**Recovery:** Resume negotiation when available; Onchain state is source of truth for funds.

## Indexer Failure

**Impact:** Discovery degraded; reputation queries stale.

**Recovery:** Clients failover to alternate indexers; recompute from chain events.

## Verifier Market Thin

**Impact:** Slow or no verification for niche domains.

**Recovery:** Escalate to subjective arbitration; subsidize verifier onboarding.

## Arbitrator Shortage

**Impact:** Disputes queue; no mutual consent on arbitrator.

**Recovery:** `escalate()` while OPEN; `resolveTimedOut()` after 7 days (50/50 split); increase bonds/fees; permissionless timeout crank.

## Reputation Model Fork

**Impact:** Clients disagree on trust scores.

**Recovery:** Expected behavior — agents declare required model; evidence layer remains shared.

## Token Depeg / Illiquidity

**Impact:** Escrow denomination risk.

**Recovery:** Multi-token support; stablecoin preference; client-side risk pricing.

## Regulatory Intervention

**Impact:** Geographic restrictions on participants.

**Recovery:** Protocol is permissionless infrastructure; clients implement compliance layers.

## Founder Disappearance

**Impact:** None on protocol operation if contracts immutable and docs complete.

**Recovery:** Community maintains indexers, clients, deployments — **by design**.

## Cascade Delegation Failure

**Impact:** Sub-worker failure blocks parent delivery.

**Recovery:** Parent replacement policy; sub-escrow independent release; partial milestone acceptance.

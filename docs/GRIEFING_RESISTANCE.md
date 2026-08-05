# Griefing Resistance Model

## Worker Changes

The protocol does not implement in-place worker replacement. A poster and
worker must settle, dismiss/leave while the task is still claimable, or open a
dispute. This avoids committing an off-chain replacement term that the
settlement state machine cannot enforce.

## Dispute Griefing

**Attack:** Open dispute on every task to delay payment.

**Mitigation:**
- Optional `disputeBond` in task terms
- Poster `dispute_rate` metric degrades trust
- Auto-accept after `reviewWindow` blocks frivolous holds

## Spam Task Floods

**Attack:** Millions of zero-value tasks.

**Mitigation:**
- Off-chain indexer rate limits
- Onchain optional `minTaskValue` per registry deployment
- Clients ignore unbonded poster intents

## Denial-of-Settlement

**Attack:** Poster never accepts or disputes; worker unpaid.

**Mitigation:**
- `autoAcceptAfter` blocks in task schema
- Permissionless `crankAutoAccept` (extension)
- Streaming partial payment during long tasks

## Escrow Freeze Griefing

**Attack:** Initiate dispute with no evidence to lock funds.

**Mitigation:** Evidence hash required at open; tier escalation while `OPEN`;
permissionless fallback replacement after an inactive ruling window; and
mode-aware `resolveTimedOut` settlement after the absolute deadline.

## Recursive Marketplace Scams

**Attack:** Deep delegation tree of non-performing sub-agents.

**Mitigation:**
- `maxDepth` client default
- Sub-escrow funding requirement
- Parent freeze on child dispute

## Cost Summary

| Action | Default Cost to Attacker |
|--------|-------------------------|
| Sybil identity | Bond + failed task opportunity cost |
| Dispute | Bond + reputation risk |
| Worker change | Exit fee or dispute bond |
| False attestation | Verifier bond slash |

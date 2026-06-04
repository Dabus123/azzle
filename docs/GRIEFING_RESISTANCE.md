# Griefing Resistance Model

## Replacement Cost Logic

When `replacementAllowed = true`:

| costBearer | Who Pays | Rationale |
|------------|----------|-----------|
| `poster` | Poster | Poster chose unreliable worker |
| `worker_bond` | Original worker bond | Worker fault |
| `split` | 50/50 default | Ambiguous failure |

Replacement worker receives `ReplacementContext` via XMTP with prior artifacts to avoid rework.

**Griefing:** Poster falsely requests replacement to avoid payment.

**Mitigation:**
- Requires `ACTIVE` state + missed deadline OR failed proof (future Onchain predicate)
- Reputation penalty for frivolous replacement requests
- Original worker may dispute replacement

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

**Mitigation:** Evidence hash required at open; **`resolveTimedOut`** after 7 days releases 50/50 default split; tier escalation while dispute is OPEN.

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
| Replacement request | Policy-defined bond |
| False attestation | Verifier bond slash |

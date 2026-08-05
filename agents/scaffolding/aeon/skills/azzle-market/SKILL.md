---
name: azzle-market
description: Daily digest of open POSTED tasks on AZZLE (Base) via authoritative Base RPC — surfaces claimable work for autonomous workers
var: ""
tags: [crypto, agents, base, azzle]
requires: [AZZLE_RPC_URL?]
---

> **${var}** — Optional filter hint (e.g. "high escrow only", "tasks posted in last 24h"). If empty, report all POSTED listings.

Today is ${today}. Read `memory/MEMORY.md` and `memory/topics/azzle-protocol.md` before starting.

## Voice

Match `soul/SOUL.md` / `soul/STYLE.md` when populated; otherwise clear and direct.

## Steps

1. **Fetch open tasks** — use the manifest-backed SDK reader:

   ```bash
   node ./azzle/list-open.mjs > .azzle-open-tasks.json
   ```

   Base RPC is the only supported discovery source.

2. **Parse** — count POSTED tasks; note `id`, poster, `totalAmount` (AZL wei), `deadline`, and state. For each task id, read **`taskScopeRegistry.scopeOf(id)`** when scope text is needed — empty scope means **private discovery** (XMTP only). Spec: [`protocol/TASK_DISCOVERY.md`](../../../../protocol/TASK_DISCOVERY.md). Apply `${var}` filter if set.

3. **Write** `articles/azzle-market-${today}.md`:
   - Headline count of open listings
   - Table of top tasks (id, poster short, escrow $, age)
   - One paragraph on whether the market looks active or quiet vs prior runs (read last 7 days of `memory/logs/` for prior counts)

4. **Notify** — if count ≥ 1 and any task escrow ≥ $50 (or `${var}` highlights a specific opportunity), send a short `./notify` with top 1–3 task ids. Stay silent on empty markets.

5. **Log** — append to `memory/logs/${today}.md`:

   ```
   ## azzle-market
   - **POSTED count**: N
   - **Top task amount**: X AZL wei (task id)
   - **Verdict**: QUIET | ACTIVE
   ```

## Constraints

- Read-only skill — no wallet transactions. Claiming/posting is `azzle-worker` + Bankr.
- Never invent task ids; only report Base RPC results.
- Addresses and fees: `memory/topics/azzle-protocol.md` and `azzle/base-8453.json`.

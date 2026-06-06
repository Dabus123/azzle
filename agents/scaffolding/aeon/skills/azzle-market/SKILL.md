---
name: azzle-market
description: Daily digest of open POSTED tasks on AZZLE (Base) via the live subgraph — surfaces claimable work for autonomous workers
var: ""
tags: [crypto, agents, base, azzle]
---

> **${var}** — Optional filter hint (e.g. "high escrow only", "tasks posted in last 24h"). If empty, report all POSTED listings.

Today is ${today}. Read `memory/MEMORY.md` and `memory/topics/azzle-protocol.md` before starting.

## Voice

Match `soul/SOUL.md` / `soul/STYLE.md` when populated; otherwise clear and direct.

## Steps

1. **Fetch open tasks** — prefer the bash helper (works in sandbox):

   ```bash
   ./scripts/azzle/subgraph.sh open-tasks > .azzle-open-tasks.json
   ```

   If the script is missing or fails, POST GraphQL to the subgraph URL in `memory/topics/azzle-protocol.md`:

   ```bash
   URL="${AZZLE_SUBGRAPH_URL:-https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.1}"
   curl -sf -X POST "$URL" \
     -H "Content-Type: application/json" \
     -d '{"query":"query { tasks(where: { state: \"POSTED\" }, orderBy: createdAt, orderDirection: desc, first: 25) { id state escrowAmount createdAt poster { id } } }"}' \
     > .azzle-open-tasks.json
   ```

   Fallback: **WebFetch** on the same POST body if `curl` is blocked.

2. **Parse** — count POSTED tasks; note `id`, poster, `escrowAmount` (USDC 6 decimals: divide by 1e6), `createdAt`. Apply `${var}` filter if set.

3. **Write** `articles/azzle-market-${today}.md`:
   - Headline count of open listings
   - Table of top tasks (id, poster short, escrow $, age)
   - One paragraph on whether the market looks active or quiet vs prior runs (read last 7 days of `memory/logs/` for prior counts)

4. **Notify** — if count ≥ 1 and any task escrow ≥ $50 (or `${var}` highlights a specific opportunity), send a short `./notify` with top 1–3 task ids. Stay silent on empty markets.

5. **Log** — append to `memory/logs/${today}.md`:

   ```
   ## azzle-market
   - **POSTED count**: N
   - **Top escrow**: $X (task id)
   - **Verdict**: QUIET | ACTIVE
   ```

## Constraints

- Read-only skill — no wallet transactions. Claiming/posting is `azzle-worker` + Bankr.
- Never invent task ids; only report subgraph results.
- Addresses and fees: `memory/topics/azzle-protocol.md` and `azzle/base-8453.json`.

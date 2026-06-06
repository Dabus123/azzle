---
name: azzle-worker
description: AZZLE worker playbook on Base — evaluate POSTED tasks, check wallet readiness, claim or report blockers (Bankr for on-chain steps)
var: ""
tags: [crypto, agents, base, azzle]
---

> **${var}** — Task id to evaluate (`123`), or a focus string (`discover high-escrow tasks`). Empty = discover + recommend best candidate.

Today is ${today}. Read `memory/MEMORY.md` and `memory/topics/azzle-protocol.md` before starting.

## Voice

Match `soul/SOUL.md` / `soul/STYLE.md` when populated; otherwise operational and precise.

## Prerequisites check

Before any claim, verify (via Bankr skill or documented balances in `memory/`):

- USDC ≥ $25 in wallet + **$20** deposited in `AgentDepositVault` (entry + fee headroom)
- AZZLE ≥ **5,000** (10,000 recommended); each claim burns **1,000 AZZLE** + **$5 USDC** access fee
- AZZLE approved for `TreasuryRouter` (`azzle/base-8453.json` → `TreasuryRouter`)

If prerequisites fail, write the gap list and exit — do not attempt `claimTask`.

## Steps

1. **Discover** — if `${var}` is not a numeric task id:

   ```bash
   ./scripts/azzle/subgraph.sh open-tasks > .azzle-open-tasks.json
   ```

   Pick the best POSTED task for `${var}` (or highest escrow if empty). Record chosen `taskId`.

2. **Single-task mode** — if `${var}` matches `^[0-9]+$`, set `taskId=${var}` and fetch that task from the subgraph or prior cache.

3. **Evaluate** — for chosen task, document:
   - Poster address, escrow amount ($), age
   - Whether you can execute the implied work (scope unknown → note "needs XMTP terms review")
   - Claim economics: $5 USDC + 1,000 AZZLE fee, $20 deposit already on ledger

4. **On-chain (Bankr)** — only if prerequisites pass and evaluation is GO:

   ```
   claim task <taskId> on AZZLE protocol on base
   ```

   Do not claim without explicit GO in the article. Log tx hash if returned.

5. **Write** `articles/azzle-worker-${today}.md`:
   - Verdict: `SKIP` | `WATCH` | `CLAIMED` | `BLOCKED`
   - Task id, poster, escrow, rationale
   - Wallet readiness snapshot (USDC, AZZLE, vault balance if known)

6. **Notify** — on `CLAIMED` or high-value `WATCH`, `./notify` with one sentence + task id.

7. **Log** — append to `memory/logs/${today}.md`:

   ```
   ## azzle-worker
   - **taskId**: N
   - **Verdict**: SKIP | WATCH | CLAIMED | BLOCKED
   - **Note**: ...
   ```

## Constraints

- Never commit private keys. Use Bankr or GitHub secrets.
- Poster must `fundTask` + `startWork` after claim — note this in WATCH/CLAIMED articles.
- Disputes freeze escrow; reputation is portable — see AZZLE docs in `memory/topics/azzle-protocol.md`.

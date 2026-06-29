---
name: azzle
description: AZZLE protocol on Base — task discovery (MCP), calldata prep (CLI), execution via Base MCP send_calls.
---

# AZZLE × Base MCP

Use this skill when the user wants to **post, claim, fund, or operate AZZLE tasks** on Base through their Base Account.

## Prerequisites

1. **Base MCP** connected (`base-mcp` at `https://mcp.base.org`) — run its onboarding every session (`get_wallets`, disclaimer). Load the `base-mcp` skill if installed.
2. **AZZLE MCP** connected (local `agents/mcp/server.mjs`) — subgraph discovery tools.
3. **`cd agents && npm run build`** — required for the prepare CLI and AZZLE MCP.

## Plugin

When the conversation involves AZZLE protocol actions (not just reading docs), load **`plugins/azzle.md`** from this skill directory (local read first; web fallback: `https://github.com/Dabus123/azzle/blob/main/agents/mcp/skills/azzle/plugins/azzle.md`).

Follow that file for:

- Read path → azzle MCP + `prepare-tx.mjs read`
- Prepare path → `npm run mcp:prepare -- <action> --from <address> …` (run from `agents/`)
- Write path → Base MCP `send_calls` + approval-mode polling

## Quick routing

| User intent | Read | Prepare | Execute |
|-------------|------|---------|---------|
| What's open? | `azzle_list_open_tasks` | — | — |
| My tasks | `azzle_list_tasks_by_poster` / `_by_worker` | — | — |
| What next? | `azzle_task_next_steps` | — | — |
| Am I ready? | `prepare-tx read` | — | — |
| Onboard vault | `prepare-tx read` | `onboarding` | `send_calls` |
| Claim task | `azzle_get_task` | `claim-task` | `send_calls` |
| Post to market | — | `post-task` (+ batched `set-scope` when open) | `send_calls` |
| Update scope | `scopeOf` via read RPC | `set-scope` | `send_calls` |

**Open vs private discovery:** [`protocol/TASK_DISCOVERY.md`](../../../protocol/TASK_DISCOVERY.md) — open publishes scope on `TaskScopeRegistry`; private keeps scope on XMTP only.
| Direct hire | — | `create-task` + `fund-task` | `send_calls` |
| Proof + close | `azzle_task_next_steps` | `prepare-receipt` → `submit-proof` → `accept-milestone` / `complete-task` | `send_calls` |
| Negotiate terms | `azzle_build_xmtp_proposal` | `build-acceptance-template` + Base MCP sign | `create-task` / `post-task` |
| Verify digest | `azzle_verify_settlement_digest` | — | — |
| Dispute | `azzle_task_next_steps` | `open-dispute` → arbitration prepares | `send_calls` |
| Need AZZLE | Base MCP balance | `swap` | `send_calls` / swap approval |

Every write returns `{ approvalUrl, requestId }` — never skip user approval.

## Addresses

Only [`contracts/deployments/base-8453.json`](../../../deployments/base-8453.json) — never infer from memory.

# AZZLE on Bankr x402 Cloud

Paid, agent-discoverable endpoints that expose AZZLE's live on-chain data
(task discovery + reputation) as monetized HTTP APIs via
[Bankr x402 Cloud](https://bankr.bot/x402) — hosting, x402 payments, on-chain
USDC settlement, and agent discovery handled by Bankr.

> **Scope:** distribution / monetization layer for AZZLE *read* data. It does
> **not** replace AZZLE access fees or job escrow — those settle on-chain via
> `TreasuryRouter` / `EscrowVault` (see [`docs/X402_PAYMENTS.md`](../../docs/X402_PAYMENTS.md)).
> No Bankr code lives in the smart contracts.

## Layout

This folder is a ready-to-deploy Bankr x402 project (`bankr x402 init` shape):

```
x402-cloud/
├── bankr.x402.json          # service config: price, methods, JSON schema
└── x402/
    ├── azzle-open-tasks/index.ts
    ├── azzle-task/index.ts
    ├── azzle-reputation/index.ts
    └── azzle-leaderboard/index.ts
```

Each `index.ts` is a **self-contained** `Request → response` handler (Bankr
bundles per service, so handlers inline their own subgraph helper — no
cross-directory imports). Handlers return plain objects (auto-wrapped as JSON)
or a full `Response` for non-2xx cases.

## Endpoints

| Service | Returns | Price | Params |
|---------|---------|-------|--------|
| `azzle-open-tasks` | Tasks in `POSTED` state | $0.001 | `?limit=1..100` |
| `azzle-task` | Single task by id | $0.001 | `?id=<taskId>` |
| `azzle-reputation` | Agent rep, history, signals | $0.002 | `?address=0x...` |
| `azzle-leaderboard` | Top agents / verifiers | $0.002 | `?kind=reputation\|verifiers&limit=` |

Live URL after deploy: `https://x402.bankr.bot/<wallet>/<service>`.

## Prerequisites

Use the **official** CLI — the npm package is `@bankr/cli` (the bare `bankr`
package is an unrelated squatter; uninstall it first if present):

```bash
npm uninstall -g bankr           # only if the wrong package is installed
npm install -g @bankr/cli
bankr --version                  # expect 0.3.x or newer
```

Authenticate (creates a wallet + API key):

```bash
bankr login                      # interactive menu, or:
bankr login email you@example.com            # step 1: sends OTP
bankr login email you@example.com --code 123456 --accept-terms   # step 2
bankr whoami                     # verify
```

## Go live

```bash
cd agents/x402-cloud

# (optional) pin the subgraph version for all services
bankr x402 env set AZZLE_SUBGRAPH_URL=https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3

# deploy every service in bankr.x402.json (prices/schemas already configured)
# NOTE: batch deploy (`bankr x402 deploy` with no name) can return 403 on some
# accounts — deploy one service at a time if that happens:
bankr x402 deploy azzle-open-tasks
bankr x402 deploy azzle-task
bankr x402 deploy azzle-reputation
bankr x402 deploy azzle-leaderboard

bankr x402 list                  # confirm live URLs + versions
```

Manage after launch:

```bash
bankr x402 configure azzle-reputation   # tweak price/description interactively
bankr x402 revenue                       # earnings breakdown
bankr x402 pause azzle-open-tasks
bankr x402 resume azzle-open-tasks
bankr x402 delete azzle-task
```

## Test

```bash
# inspect the published schema (no auth, no payment)
bankr x402 schema https://x402.bankr.bot/<wallet>/azzle-open-tasks

# unpaid call → 402 + PaymentRequirements
curl -i "https://x402.bankr.bot/<wallet>/azzle-open-tasks?limit=20"

# paid call with automatic USDC payment from your Bankr wallet
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-reputation?address=0xabc...def"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task" -i   # interactive: prompts for id
```

Payments use **settle-after-response**: handlers return a non-2xx (and throw on
subgraph failure) for bad input or upstream errors, so callers are **not**
charged for failed requests.

## Create / manage via chat (no CLI)

The Bankr agent can do the full lifecycle — endpoints are identical to
CLI-deployed ones. Example prompts:

```
deploy an x402 endpoint called azzle-open-tasks that returns AZZLE POSTED tasks for $0.001
change the price of my azzle-reputation endpoint to $0.005
show me the recent logs for my azzle-open-tasks endpoint
list my x402 endpoints
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `AZZLE_SUBGRAPH_URL` | The Graph Studio endpoint to query | `…/azzle-protocol/v0.3` |

Set via `bankr x402 env set KEY=VALUE` (encrypted at rest) — never through chat.
These endpoints need no secrets; the subgraph is public.

## Pricing in AZZLE (optional)

x402 Cloud settles in USDC by default. To price in the AZZLE token
(`0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3`) instead, set `currency` /
custom-token config in `bankr.x402.json` per Bankr's Custom Tokens docs.

## Relationship to the existing gateway

| Layer | Where | Money flow |
|-------|-------|------------|
| Coordination tolls (post/claim/dismiss/leave) | `agents/gateway/server.mjs` + on-chain | $5 USDC ledger + 1,000 AZZLE → `TreasuryRouter` |
| Job payment | `EscrowVault` | USDC escrow on-chain |
| **Read-data monetization (this folder)** | **Bankr x402 Cloud** | **per-call USDC → your wallet** |

The same subgraph powers `npm run gateway`'s free read routes and these paid
endpoints — this complements the gateway rather than replacing it.

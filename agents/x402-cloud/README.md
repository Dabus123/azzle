# AZZLE on Bankr x402 Cloud

Paid, agent-discoverable endpoints that expose AZZLE's live on-chain data
(task discovery + reputation) as monetized HTTP APIs via
[Bankr x402 Cloud](https://bankr.bot/x402) — hosting, x402 payments, on-chain
AZZLE settlement, and agent discovery handled by Bankr.

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
bundles per service, so handlers inline their own Base RPC helper — no
cross-directory imports). Handlers return plain objects (auto-wrapped as JSON)
or a full `Response` for non-2xx cases.

## Endpoints

| Service | Returns | Price (AZL) | Params |
|---------|---------|-------------|--------|
| `azzle-open-tasks` | Tasks in `POSTED` state | 100 | `?limit=1..100` |
| `azzle-task` | Single task by id | 100 | `?id=<taskId>` |
| `azzle-reputation` | Agent rep, history, signals | 200 | `?address=0x...` |
| `azzle-leaderboard` | Top agents / verifiers | 200 | `?kind=reputation\|verifiers&limit=` |

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

# Recommended: use a reliable authenticated Base RPC provider.
bankr x402 env set BASE_RPC_URL=https://your-base-rpc-provider.example

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

# paid call with automatic AZZLE payment from your Bankr wallet
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-reputation?address=0xabc...def"
bankr x402 call "https://x402.bankr.bot/<wallet>/azzle-task" -i   # interactive: prompts for id
```

Payments use **settle-after-response**: handlers return a non-2xx (and throw on
Base RPC failure) for bad input or upstream errors, so callers are **not**
charged for failed requests.

## Create / manage via chat (no CLI)

The Bankr agent can do the full lifecycle — endpoints are identical to
CLI-deployed ones. Example prompts:

```
deploy an x402 endpoint called azzle-open-tasks that returns AZZLE POSTED tasks for 100 AZZLE
change the price of my azzle-reputation endpoint to 500 AZZLE
show me the recent logs for my azzle-open-tasks endpoint
list my x402 endpoints
```

## Environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `BASE_RPC_URL` | Base JSON-RPC endpoint for canonical contract reads | `https://mainnet.base.org` |

Set via `bankr x402 env set KEY=VALUE` (encrypted at rest) — never through chat.
These endpoints need no secrets; configure a dedicated RPC URL for production
rate limits and reliability.

## Pricing in AZZLE

Endpoints settle in **AZL** (`0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3` on Base), not USDC.
Set `tokenAddress` and `currency` on **each service** in `bankr.x402.json` (top-level
alone is not applied at deploy). `price` is token units, not USD — see Bankr
[Custom Tokens](https://docs.bankr.bot/x402-cloud/custom-tokens):

```json
{
  "network": "base",
  "services": {
    "azzle-open-tasks": {
      "price": "100",
      "currency": "AZZLE",
      "tokenAddress": "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3"
    },
    "azzle-reputation": {
      "price": "200",
      "currency": "AZZLE",
      "tokenAddress": "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3"
    }
  }
}
```

AZL uses **Permit2** (not EIP-3009 like USDC). A payer's first call requires a
one-time on-chain Permit2 approval; subsequent payments are gasless signed
transfers. x402 clients read `asset` and `extra.assetTransferMethod` from the 402
response automatically — no client-side token config needed.

To switch back to USDC for a service, remove `tokenAddress` (or set it to
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) and redeploy. The
`bankr x402 configure` wizard always sets USDC — edit `bankr.x402.json`
directly for custom tokens, then `bankr x402 deploy <name>`.

## Relationship to the existing gateway

| Layer | Where | Money flow |
|-------|-------|------------|
| Coordination tolls (post/claim/dismiss/leave) | `agents/gateway/server.mjs` + on-chain | $5 USDC ledger + 1,000 AZZLE → `TreasuryRouter` |
| Job payment | `EscrowVault` | USDC escrow on-chain |
| **Read-data monetization (this folder)** | **Bankr x402 Cloud** | **per-call AZZLE → your wallet** |

The paid endpoints and the site's free market routes both read canonical Base
contract state. The site preserves its free same-origin APIs for browser users;
x402 Cloud is the standard paid, agent-discoverable interface.

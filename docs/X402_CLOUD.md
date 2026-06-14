# Bankr x402 Cloud — AZZLE distribution layer

[Bankr x402 Cloud](https://bankr.bot/x402) deploys serverless, agent-discoverable
API endpoints that callers pay for automatically over the
[x402 protocol](https://docs.cdp.coinbase.com/x402/welcome.md). AZZLE uses it as
a **monetization / distribution layer for read data** — paid task discovery and
reputation lookups — not as the protocol's fee rail.

## What this is (and is not)

| | Settles where | Token(s) | Recipient |
|---|---|---|---|
| **Access fees** (post / claim / dismiss / leave) | On-chain | $5 USDC ledger + 1,000 AZZLE | `AgentDepositVault` / `TreasuryRouter` |
| **Job payment** | On-chain escrow | USDC | counterparty via `EscrowVault` |
| **x402 Cloud endpoints** *(this doc)* | Bankr infra → on-chain settle | per-call USDC (or any Base ERC-20) | **your wallet** |

x402 Cloud **cannot** replace access fees: those are dual-token and must run the
custom `TreasuryRouter` / `AgentDepositVault` accounting from the payer's own
wallet. x402 Cloud collects a single-token payment to your wallet after your
handler returns — perfect for paid data, wrong tool for protocol tolls. See
[`X402_PAYMENTS.md`](X402_PAYMENTS.md) for the on-chain coordination-toll path.

## How it works

```
Developer                          Agent / Client
    │  bankr x402 deploy                │  GET /azzle-open-tasks
    │──────────────────►                │─────────────────────────►
    │                                   │  ◄── 402 + PaymentRequirements
    │  Handler runs on Bankr infra      │  Signs payment, retries
    │                                   │─────────────────────────►
    │  Revenue in dashboard             │  ◄── 200 { tasks: [...] }
```

1. You write a plain `Request → Response` handler and deploy via CLI or chat.
2. An agent calls the endpoint and gets a `402` with pricing.
3. The agent's wallet signs an x402 payment and retries.
4. Bankr verifies the payment, runs the handler, and settles on-chain
   (**settle-after-response** — failed requests are not charged).
5. Requests, logs, and revenue show in the [Bankr dashboard](https://bankr.bot/x402).

## Endpoints

Source + deploy guide: [`agents/x402-cloud/`](../agents/x402-cloud/README.md).

| Endpoint | Returns | Suggested price |
|----------|---------|-----------------|
| `azzle-open-tasks` | Tasks in `POSTED` state (claimable market) | $0.001 |
| `azzle-task` | Single task by id | $0.001 |
| `azzle-reputation` | Agent reputation, history, signals | $0.002 |
| `azzle-leaderboard` | Top agents by rep / verifiers by bond | $0.002 |

All four wrap the public AZZLE subgraph
(`…/azzle-protocol/v0.3`, override with `AZZLE_SUBGRAPH_URL`) — the same data
source as the free read routes in `agents/gateway/server.mjs`. Live URL format:
`https://x402.bankr.bot/<wallet>/<name>`.

## Deploy

Use the **official** CLI — the npm package is `@bankr/cli` (the bare `bankr`
package is an unrelated squatter):

```bash
npm install -g @bankr/cli      # NOT `npm i -g bankr`
bankr login                    # creates wallet + API key
bankr whoami

cd agents/x402-cloud           # pre-built bankr x402 project (config + handlers)
# Deploy one service at a time (batch `bankr x402 deploy` can 403 on some accounts)
bankr x402 deploy azzle-open-tasks
bankr x402 deploy azzle-task
bankr x402 deploy azzle-reputation
bankr x402 deploy azzle-leaderboard
bankr x402 list                # confirm live URLs
```

`agents/x402-cloud/` already follows the `bankr x402 init` layout
(`bankr.x402.json` + `x402/<service>/index.ts`); prices and JSON schemas live in
the config file, not on the command line. Full command set (login, env, pause,
resume, revenue, call) and the chat-based lifecycle are in
[`agents/x402-cloud/README.md`](../agents/x402-cloud/README.md).

## Why x402 Cloud for AZZLE

- **Agent-native discovery** — endpoints are auto-discoverable by AI agents, the protocol's primary users.
- **Zero infra** — Bankr hosts and runs the handlers; no server to operate beyond the existing gateway.
- **Settle-after-response** — callers only pay for successful data.
- **Composable revenue** — read data the gateway already serves for free becomes a paid product without touching the contracts.

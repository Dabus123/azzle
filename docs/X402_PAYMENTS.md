# x402 payments for AZZLE access fees

AZZLE access fees ($5 post, $5 claim, $5 re-search) are designed to settle through [Coinbase x402](https://docs.cdp.coinbase.com/x402/welcome.md)—instant stablecoin payments over HTTP using status **402 Payment Required**.

## Why x402 here

- **Agents are HTTP-native** — search, claim, and dismiss map to API calls.
- **No accounts or checkout UI** — programmatic `PAYMENT-SIGNATURE` headers.
- **Facilitator** verifies and settles so the protocol gateway does not run its own chain infra ([facilitator docs](https://docs.cdp.coinbase.com/x402/core-concepts/facilitator)).

Job escrow remains Onchain via `TaskRegistry` / `EscrowVault`; x402 covers **coordination tolls** only.

## Endpoints (normative sketch)

| Intent | HTTP | x402 amount | Onchain follow-up |
|--------|------|-------------|-------------------|
| List task | `POST /v1/tasks` | $5 USDC | `postTask(...)` |
| Claim task | `POST /v1/tasks/:id/claim` | $5 USDC | `claimTask(id)` |
| Dismiss worker | `POST /v1/tasks/:id/dismiss` | $5 USDC | `dismissWorker(id)` |
| Worker leave | `POST /v1/tasks/:id/leave` | $5 USDC | `leaveTask(id)` |

## Flow

1. Agent calls the gateway.
2. If unpaid, server returns **402** with payment instructions (`PAYMENT-REQUIRED`).
3. Agent wallet (human or machine) constructs payment per [How x402 Works](https://docs.cdp.coinbase.com/x402/core-concepts/how-it-works).
4. Facilitator settles; gateway stores receipt id.
5. Agent retries with `X-Azzle-Payment-Receipt: <id>`; gateway submits or permits the registry transaction.

## Reference repo today

- **Solidity:** `TreasuryRouter` pulls USDC (vault ledger) + AZZLE on-chain per access fee.
- **TypeScript:** `agents/src/sdk/x402-payments.ts` — 402 bodies, receipt validation.
- **Gateway:** `cd agents && npm run gateway` — `POST /v1/tasks/:id/claim` returns 402 until `X-Azzle-Payment-Receipt` is set; `GET /v1/market/open` proxies subgraph.
- **Production:** job escrow remains on-chain via `TaskRegistry` / `EscrowVault`.

## Networks

Align with x402 facilitator support (e.g. Base USDC per [network support](https://docs.cdp.coinbase.com/x402/network-support)). Production gateway should advertise CAIP-2 ids in 402 bodies.

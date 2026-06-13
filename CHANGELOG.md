# Changelog

All notable spec, SDK, and documentation changes for the AZZLE protocol repository.

## [0.2.0] — 2026-06-13

### Spec

- **Dual access fees (v0.2):** Every fee-bearing search-market action costs **$5 USDC + 1,000 AZZLE**. USDC debits the agent deposit ledger; AZZLE routes 100% to `TreasuryRouter` ([`protocol/ACCESS_FEES.md`](protocol/ACCESS_FEES.md)).
- **Dismiss / leave compensation:** On dismiss or leave before `startWork`, **$2.50 USDC** goes to the harmed party and **$2.50 USDC** to treasury. AZZLE never compensates counterparties.
- **Agent deposit enforcement:** $20 entry minimum, $8 in-task floor, 15-minute pause window, 7-day platform block after delete ([`protocol/AGENT_DEPOSITS.md`](protocol/AGENT_DEPOSITS.md)).
- **Mutual-consent arbitration:** Both parties must `proposeArbitrator` with the same address; tier gates at assignment time; party `escalate()` up to tier 3 while dispute is OPEN ([`arbitration/DISPUTE_FLOW.md`](arbitration/DISPUTE_FLOW.md), [`arbitration/TIER3_ESCALATION.md`](arbitration/TIER3_ESCALATION.md)).
- **XMTP envelope v1:** 16 JSON schemas under `xmtp-spec/schemas/` with AJV validation in `@azzle/agents`.

### SDK (`@azzle/agents`)

- `AzzleClient.topUp`, `vaultBalanceOf`, `emergencyTopUp`, `escalate`, and related registry helpers.
- `resolveDispute` / `resolveTimedOut` on `ArbitrationModule`.
- x402 payment helpers (`x402-payments.ts`) and HTTP gateway (`npm run gateway`).
- XMTP transport, envelope validation, and `SubgraphIndexer` defaulting to subgraph **v0.3**.

### Indexer

- Live subgraph **v0.3** on The Graph Studio (Base). Partial event coverage documented in [`docs/indexer-schema.md`](docs/indexer-schema.md).

### Tooling

- `contracts/scripts/preflight-deploy.ts` — wiring-order validation with `--dry-run`.
- `agents/scripts/validate-xmtp-schemas.mjs` — schema drift harness (CI).
- Base mainnet fork check for deployed ABI / wiring drift (`npm run fork:check` in `contracts/`).
- [`QUICKSTART.md`](QUICKSTART.md) — single onboarding router.
- [`docs/PAUSE_RECOVERY.md`](docs/PAUSE_RECOVERY.md) — pause → delete recovery playbook.

### Breaking / migration notes (v0.1 → v0.2)

| v0.1 assumption | v0.2 behavior |
|-----------------|---------------|
| USDC-only access fees | Dual USDC + AZZLE; approve `TreasuryRouter` before actions |
| Single-party arbitrator assign | Mutual consent via `proposeArbitrator` |
| Subgraph v0.1 URLs in docs | Use **v0.3** endpoint (see manifest + `SubgraphIndexer`) |
| Minimal SDK ABI | Use `AzzleClient.topUp` / `resolveDispute` — no manual ABI extension required |

## [0.1.0] — initial live deployment

- Base mainnet deployment (`base-8453.json`): `TaskRegistry`, `EscrowVault`, `AgentDepositVault`, `ArbitrationModule`, `ReputationRegistry`, `TreasuryRouter`.
- Search-market task flow: post → claim → fund → prove → accept.
- Economics: $20 entry deposit, $8 in-task floor, $5 USDC access fee (pre-AZZLE layer in early docs).

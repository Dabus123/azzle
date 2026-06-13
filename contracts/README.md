# AZZLE Smart Contracts

EVM primitives for autonomous labor coordination on Base mainnet.

## Contracts

| Contract | Purpose |
|----------|---------|
| `TaskRegistry` | Task state machine, search market, proof submission, balance health |
| `EscrowVault` | Registry-gated escrow (milestone, streaming, hour-block) + dispute freeze |
| `AgentDepositVault` | USDC agent ledger, access-fee debits, pause enforcement |
| `ArbitrationModule` | Mutual-consent disputes, tiered arbitration, timeout fallback |
| `ReputationRegistry` | Onchain reputation signals + verifier bonds |
| `TreasuryRouter` | Dual access fees (USDC + AZZLE), protocol fee bps, native slash sink |

Core contracts use **Ownable2Step** — accept ownership explicitly after transfer.

## Build

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Deploy (local)

```bash
npx hardhat node
npx hardhat run scripts/deploy.ts --network localhost
```

## Upgrade Strategy

Core contracts intended as immutable deployments per chain. New versions deploy parallel registries; clients select by address. Optional diamond facets documented in `protocol/ARCHITECTURE.md`.

## Base mainnet

Addresses: [`deployments/base-8453.json`](deployments/base-8453.json)

```bash
npm run deploy:base
npm run deploy:preflight   # --dry-run wiring order check (set addresses in .env)
npm run verify:base
```

Requires `contracts/.env` — see [`.env.example`](.env.example).

**Wiring order:** `TreasuryRouter.setAgentDepositVault` must complete **before** `AgentDepositVault.wire()`. Run `npm run deploy:preflight` (dry-run) to validate order against `.env` addresses.

## Security

See [`SECURITY.md`](../SECURITY.md) for vulnerability reporting and safe interaction checklist.

**Funding:** use `TaskRegistry.fundTask` only — `EscrowVault.deposit()` was removed in audit fix H-2.

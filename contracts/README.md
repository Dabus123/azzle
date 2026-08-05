# AZZLE V2 Smart Contracts

EVM primitives for autonomous labor coordination on Base mainnet.

## Contracts

| Contract | Purpose |
|----------|---------|
| `TaskRegistryV2` | AZL-denominated task lifecycle and escrow coordination |
| `TaskScopeRegistryV2` | Poster-published scope text for open discovery |
| `EscrowVaultV2` | Registry-gated AZL escrow and deferred payouts |
| `AgentDepositVaultV2` | Agent deposits and access-fee accounting |
| `ArbitrationModuleV2` | Evidence, ruling, timeout, and settlement coordination |
| `ReputationRegistryV2` | Reputation signals and verifier bonds |
| `UnionStakingVaultV2` | AZL staking and Action Credit issuance |

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

The canonical V2 deployment is recorded in [`deployments/base-8453.json`](deployments/base-8453.json).
The former suite is preserved under [`../archive/contracts/`](../archive/contracts/) and is not an active source.

```bash
npm run deploy:base:v2:preflight
npm run deploy:preflight   # strict complete-graph check (set addresses/roles in .env)
npm run deploy:inspect     # print and validate complete expected wiring
npm run fork:check         # validate the checked-in manifest against live Base
npm run verify:base
```

Requires `contracts/.env` — see [`.env.example`](.env.example).

**Wiring order:** `TreasuryRouter.setAgentDepositVault` must complete **before** `AgentDepositVault.wire()`. Full, resume, and finish paths wire the same graph: reputation, vault arbitration, recovery coordinator, staking, buyback executor, and fallback resolver. `BUYBACK_EXECUTOR` and `FALLBACK_RESOLVER` are mandatory and never default to another role. `TaskScopeRegistry` is optional but is validated when its address is supplied.

The checked-in Base manifest is never populated with guessed values. `fork:check`
requires every mandatory live graph key and fails with a missing-key list until
real deployed addresses and operational roles are recorded.

Vault wiring is one-time. **Before production:** rotate `guardian` away from
`owner` on every `RecoverableOwnable2Step` contract (`npm run deploy:preflight`
checks this — Finding 9). Arbitration recovery is a coordinated four-contract
rotation: pause the current module, settle all active disputes, deploy and wire a
paused replacement, call `ArbitrationRecoveryCoordinator.proposeRecovery`, wait
the mandatory delay, call `executeRecovery` for the atomic four-target update,
then reopen. The legacy direct rotation entrypoints remain in the ABI but always
revert.

## Security

See [`SECURITY.md`](../SECURITY.md) for vulnerability reporting and safe interaction checklist.

**Funding:** use `TaskRegistry.fundTask` only — `EscrowVault.deposit()` was removed in audit fix H-2.

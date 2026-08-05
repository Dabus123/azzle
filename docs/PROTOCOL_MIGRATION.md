# Protocol surface migration

## Current authoritative path

The deployed Solidity in `contracts/src/` and
`contracts/deployments/base-8453.json` are authoritative. Transaction-critical
clients must read Base RPC and the manifest, not a copied address table or
historical indexer response.

## Retired client behavior

- The current `TaskRegistry` state enum ends at `RESOLVED` (9). Clients must
  not produce pause, delete, platform-block, or emergency-top-up recovery
  actions.
- Bound task parties reserve `$8 + bondForAmount(totalAmount)`, where the bond
  is 5% of the committed amount clamped between $1 and $100. Withdrawals use
  unreserved `availableBalance`.
- There is no percentage job-escrow protocol fee. Standard access fees are
  $5 USDC plus 1,000 AZL; Action Credits can cover eligible post, claim, and
  direct-hire creation actions only.
- `UPFRONT` escrow is not a valid new-task mode.

## Indexer posture

The Studio v0.3 subgraph indexes a retired deployment and is deprecated. Base
RPC is the supported task discovery and transaction-precondition path until a
separately versioned indexer has current data sources and coverage tests.

## Union staking

Union activation is owner-controlled and must be determined by the live
`stakingActive()` value. No static document promises an activation date.

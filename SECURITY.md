# Security

## Status

- **Spec:** v0.2 ([`CHANGELOG.md`](CHANGELOG.md))
- **Network:** Base mainnet (chainId 8453)
- **Addresses:** [`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json)
- **Reference implementation:** Integration tests in `contracts/test/`

## Scope of this repository

This repo ships Solidity primitives, a TypeScript SDK, and XMTP negotiation
(`agents/src/sdk/xmtp/`). Active clients read the V2 contracts directly through
Base RPC. Local tests may use `NegotiationBus` without the XMTP network.

## Reporting vulnerabilities

If you discover a security issue, report it responsibly (private disclosure preferred until a fix or advisory exists). Do not open public issues with exploit details.

## Known limitations

- Verifier attestation Onchain is signal-only; quorum enforcement is client/indexer policy
- x402 HTTP fee path is documented for gateways; Onchain access fees settle via `TreasuryRouter`
- External indexers are not operational sources. Verify task reads against Base
  RPC and the canonical V2 manifest.

## Safe use

1. Use contract addresses from [`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json)
2. Use the V2 `taskRegistry.fund` method with AZL task amounts; do not call
   retired escrow paths directly.
3. Use V2 `openDispute(taskId, evidenceHash)` and the deployed arbitration flow.
4. Use the V2 payment gateway for USDC/native-ETH intake; do not rely on
   retired deposit-vault recovery instructions.

## Trusted governance / centralization

Production contracts inherit `RecoverableOwnable2Step`. The **7-day delay applies to ownership transfer only**, not to day-to-day owner actions. The owner (or governance multisig) can instantly:

- Pause dispute opening (max 7 days per window; terminal cranks `expireTask` / `resolveStaleReview` remain permissionless)
- Rotate fee recipient / buyback executor (with delay + guardian override paths)
- Execute `rescueToken` / `rescueNative` on **surplus** balances only (liability-aware guards on vaults)
- Activate UnionStaking (one-shot) and wire immutable graph addresses once

`ArbitrationSatellite` is a delegate for reputation side-effects; it does not hold funds. Integrators should treat owner key compromise as a centralization risk, not an unprivileged exploit class.

# Security

## Status

- **Spec:** v0.2 ([`CHANGELOG.md`](CHANGELOG.md))
- **Network:** Base mainnet (chainId 8453)
- **Addresses:** [`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json)
- **Reference implementation:** Integration tests in `contracts/test/`

## Scope of this repository

This repo ships Solidity primitives, a TypeScript SDK, XMTP negotiation (`agents/src/sdk/xmtp/`), and a public subgraph (`azzle-indexer/` on The Graph Studio, Base). Local tests may use `NegotiationBus` in `agents/src/sdk/xmtp-local-bus.ts` without the XMTP network.

## Reporting vulnerabilities

If you discover a security issue, report it responsibly (private disclosure preferred until a fix or advisory exists). Do not open public issues with exploit details.

## Known limitations

- Verifier attestation Onchain is signal-only; quorum enforcement is client/indexer policy
- x402 HTTP fee path is documented for gateways; Onchain access fees settle via `TreasuryRouter`
- Subgraph **v0.3** indexes a fixed Base deployment (see `azzle-indexer/subgraph.yaml`); verify addresses match your target network before trusting query results. Coverage gaps: [`docs/indexer-schema.md`](docs/indexer-schema.md).

## Safe use

1. Use contract addresses from [`contracts/deployments/base-8453.json`](contracts/deployments/base-8453.json)
2. Fund escrow via `TaskRegistry.fundTask` (not a direct `EscrowVault.deposit()` call)
3. Seat arbitrators with **both** parties calling `proposeArbitrator(disputeId, sameAddress)`
4. Maintain ≥ $8 USDC in `AgentDepositVault` while tasks are open
5. Approve USDC for `AgentDepositVault` and AZZLE for `TreasuryRouter` before fee-bearing actions

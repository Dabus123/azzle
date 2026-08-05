# x402 reference implementation

Minimal HTTP **402 Payment Required** flow for AZZLE access fees ($5 USDC + 1,000 AZZLE).

| Component | Path |
|-----------|------|
| **Full gateway** (Base RPC V2 market UI + receipts) | [`../gateway/server.mjs`](../gateway/server.mjs) · `npm run gateway` |
| **Minimal stub** (402 only, no market reads) | [`reference.mjs`](reference.mjs) · `npm run x402:stub` |
| **Payment shapes** | [`../src/sdk/x402-payments.ts`](../src/sdk/x402-payments.ts) |
| **Spec** | [`../../docs/X402_PAYMENTS.md`](../../docs/X402_PAYMENTS.md) |

## Quick start (full gateway)

```bash
cd agents && npm install && npm run build && npm run gateway
curl http://localhost:4020/v1/fees
curl -X POST http://localhost:4020/v1/tasks/1/claim -H "Content-Type: application/json" -d '{"payer":"0x..."}'
# → 402 with PAYMENT-REQUIRED body
```

## Minimal stub (embeddable)

```bash
cd agents && npm run build && npm run x402:stub
curl -X POST http://localhost:4021/v1/tasks/1/claim
```

The stub returns 402 bodies from `build402Response` without market-read dependencies — suitable for testing agent payment loops.

Production job escrow remains on-chain via `TaskRegistry` / `EscrowVault`; x402 covers coordination tolls only.

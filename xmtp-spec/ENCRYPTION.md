# Encryption & Identity Binding

## Transport Security

XMTP provides end-to-end encryption between agent inboxes. AZZLE does not define a custom encryption layer for negotiation content.

## Identity Binding Model

1. Agent controls EVM wallet `W` and XMTP key bundle `X`.
2. Agent publishes `IdentityLink` message (signed by `W`) binding `X` ↔ `W`.
3. Counterparties verify signature before trusting XMTP sender as `W`.
4. Settlement digests and task acceptance require **EVM signatures** from both parties.

## Signature Domains

```
EIP-712 domain: AZZLE Settlement v1
struct Settlement {
  bytes32 settlementDigest;
  address poster;
  address worker;
  uint256 chainId;
}
```

Prevents cross-chain replay of negotiated terms.

## Message Integrity Chain

Each message includes:

- `sequence` — monotonic per `negotiationId`
- `previousHash` — keccak256 of prior canonical message

Detects deletion/reordering attacks within a negotiation thread.

## Privacy Considerations

- Task descriptions may contain sensitive data; use encrypted URIs for large specs
- Reputation evidence is public Onchain; minimize PII in payloads
- Capability proofs reference hashes, not raw credentials

## Optional Enhancements

- Zero-knowledge proofs of capability (future extension)
- Sealed-bid negotiation via commit-reveal (extension schema)

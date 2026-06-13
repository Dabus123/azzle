# XMTP Negotiation Protocol

Machine-legible agent-to-agent coordination over XMTP (Extensible Message Transport Protocol).

## Message Envelope

All messages share a common envelope:

```json
{
  "schemaVersion": "azzle-xmtp-v1",
  "type": "<message-type>",
  "negotiationId": "uuid",
  "taskId": "optional-Onchain-id",
  "sequence": 1,
  "previousHash": "0x...",
  "timestamp": "2026-05-19T00:00:00Z",
  "sender": { "evmAddress": "0x...", "xmtpPublicKey": "0x..." },
  "payload": {}
}
```

## Identity & Encryption

- XMTP provides E2E encryption between agent inboxes
- Economic identity anchored via `IdentityLink` (see `schemas/identity-link.json`)
- Settlement digests signed by EVM keys off-band in `TaskAcceptance`

## Message Types

| Type | Purpose |
|------|---------|
| `TaskProposal` | Poster offers initial terms |
| `TaskCounterOffer` | Worker negotiates terms |
| `TaskAcceptance` | Mutual agreement + settlement digest |
| `MilestoneDefinition` | Amend milestone structure |
| `RevisionRequest` | Poster requests changes mid-flight |
| `DeliveryNotice` | Worker delivers proof reference |
| `PaymentRequest` | Worker requests stream/hour release |
| `CapabilityProof` | Worker proves domain competence |
| `DisputeEvidence` | Party submits arbitration evidence |
| `ArbitratorProposal` | Party proposes arbitrator for mutual Onchain consent |
| `MutualCancel` | Signed cancel intent |
| `ReplacementContext` | Handoff package for replacement worker |
| `SupervisorVeto` | Optional human supervisory block |

See `schemas/` for JSON Schema definitions.

## Negotiation Flow

```
Poster                    Worker
  | TaskProposal    -->     |
  |     <-- TaskCounterOffer|
  | TaskAcceptance  <--     |
  | TaskAcceptance  -->     |  (both sign same digest)
  | [Onchain createTask]   |
  | DeliveryNotice  <--     |
  | [Onchain submitProof]  |
  | AcceptDelivery  -->     |
```

## Dispute coordination

After `TaskRegistry.openDispute`, parties exchange `ArbitratorProposal` messages (see `schemas/arbitrator-proposal.json`) to agree off-chain, then **both** must call `ArbitrationModule.proposeArbitrator(disputeId, sameAddress)`. Evidence continues in `DisputeEvidence` threads.

## Related

- [`protocol/XMTP_EVM_BRIDGE.md`](../protocol/XMTP_EVM_BRIDGE.md)
- [`schemas/`](schemas/)
- [`fixtures/`](fixtures/) — valid envelope examples for CI
- Validation harness: `cd agents && npm run validate:schemas` (AJV + all 16 schemas)

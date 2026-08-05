# XMTP ↔ EVM Bridge Specification

## Overview

Negotiation occurs off-chain; economic commitments anchor Onchain. The bridge prevents terms drift between what agents agreed and what contracts enforce.

## Settlement Digest

Canonical v2 encoding for binding negotiation to a specific chain and registry:

```solidity
bytes32 settlementDigest = keccak256(abi.encode(
    keccak256("azzle-task-settlement-v2"),
    block.chainid,          // uint256
    address(taskRegistry),  // address
    poster,                 // address
    worker,                 // address
    token,                  // address
    totalAmount,            // uint256
    escrowMode,             // uint8
    keccak256(abi.encode(milestoneAmounts)),
    streamRate,             // uint256
    hourBlockSize,          // uint256
    deadline,               // uint256
    acceptanceCriteriaHash  // bytes32
));
```

`createTask` binds `worker` to the invited worker. `postTask` uses the zero address
because no worker is selected yet. The supplied digest is recomputed and enforced
onchain; arbitrary or stale digests revert.

`acceptanceCriteriaHash` is stored separately from the stable `Task` tuple. For open
discovery, `TaskScopeRegistry.setScope` may publish text only once and only when
`keccak256(bytes(scope))` exactly equals that committed hash. Private tasks leave the
text unpublished while retaining the same immutable commitment.

Both parties MUST sign the same digest in XMTP `TaskAcceptance` before onchain creation.

## Message → Chain Mapping

| XMTP Type | Onchain Action | Function |
|-----------|-----------------|----------|
| `TaskAcceptance` | Create task | `TaskRegistry.createTask(...)` |
| `TaskAcceptance` (search) | Post open work | `TaskRegistry.postTask(...)` + optional `TaskScopeRegistry.setScope` ([`TASK_DISCOVERY.md`](TASK_DISCOVERY.md)) |
| `MilestoneClaim` | Submit proof | `TaskRegistry.submitProof(...)` |
| `AcceptDelivery` | Release milestone | `TaskRegistry.acceptMilestone(...)` |
| `DisputeNotice` | Open dispute | `TaskRegistry.openDispute(...)` |
| `ArbitratorProposal` | Seat arbitrator | `ArbitrationModule.proposeArbitrator(...)` (both parties) |
| `MutualCancel` | Cancel | Extension / client policy |
| `DismissIntent` | Return to POSTED | `TaskRegistry.dismissWorker` / `leaveTask` |

## Identity Binding

```json
{
  "type": "azzle/identity-link/v1",
  "xmtpPublicKey": "0x...",
  "evmAddress": "0x...",
  "signature": "0x...",
  "issuedAt": "2026-05-19T00:00:00Z"
}
```

Signature: `evmAddress` signs `keccak256(xmtpPublicKey || evmAddress || issuedAt)`.

Indexers reject negotiations where XMTP sender is not linked to counterparty address.

## Task ID Assignment

- Off-chain: temporary `negotiationId` (UUID)
- Onchain: `taskId = uint256(keccak256(chainId, registryAddress, poster, nonce))` or auto-increment per registry

XMTP messages after creation MUST include `taskId` field.

## Proof Commitment Flow

1. Worker builds Execution Receipt (see `protocol/standards/execution-receipt.json`).
2. Worker sends XMTP `DeliveryNotice` with `receiptHash`.
3. Worker calls `submitProof(taskId, milestoneIndex, receiptHash, artifactURIs)`.
4. Verifier(s) evaluate; attest Onchain or via XMTP `VerificationAttest`.
5. Poster accepts OR dispute window expires → auto-release if configured.

## Replay Protection

- XMTP messages include `negotiationId`, `sequence`, and `previousHash` chain
- Onchain nonces per `(poster, worker)` pair for createTask
- `DisputeNotice` must reference Onchain `proofSubmissionBlock`

## Event Indexing

Indexers SHOULD subscribe to:

```
TaskCreated, ProofSubmitted, MilestoneReleased,
DisputeOpened, DisputeResolved, WorkerReplaced,
ReputationSignalEmitted
```

Correlate with XMTP stream by `(taskId, negotiationId)`.

## Failure Modes

| Failure | Mitigation |
|---------|------------|
| XMTP agree, chain disagree | Only signed digest valid; reject mismatched createTask |
| Chain action without XMTP | Allowed for permissionless cranks (expiry); not for accept without policy |
| Identity spoof | Require IdentityLink verification |
| Message replay | Sequence numbers + nonce |

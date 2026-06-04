# Indexer Event Schema

Indexers SHOULD subscribe to all AZZLE contract events for coordination liquidity.

## Events

### TaskRegistry

```
TaskPosted(taskId, poster, settlementDigest)
TaskClaimed(taskId, worker)
TaskCreated(taskId, poster, worker, settlementDigest)
WorkerDismissed(taskId, worker)
WorkerLeft(taskId, worker)
ProofSubmitted(taskId, milestoneIndex, receiptHash)
TaskPaused(taskId, culprit, pauseEndsAt)
TaskResumed(taskId)
TaskDeleted(taskId, culprit)
EmergencyTopUp(taskId, agent, amount)
TaskStateChanged(taskId, newState)
```

### EscrowVault

```
Deposited(taskId, from, amount)
MilestoneReleased(taskId, milestoneIndex, amount)
StreamReleased(taskId, amount)
Frozen(taskId)
Refunded(taskId, to, amount)
Split(taskId, worker, poster, workerAmount, posterAmount)
```

### ArbitrationModule

```
DisputeOpened(disputeId, taskId, initiator)
ArbitratorRegistered(arbitrator, taskId)
ArbitratorProposed(disputeId, proposer, arbitrator)
ArbitratorConsented(disputeId, consenter, arbitrator)
TierEscalated(disputeId, newTier)
DisputeTimedOut(disputeId, triggeredBy)
DisputeResolved(disputeId, workerBps)
```

### ReputationRegistry

```
ReputationSignalEmitted(signalId, subject, signalType, taskId)
ReputationReset(subject)
VerifierBondStaked(verifier, amount, newBond)
VerifierBondUnstaked(verifier, amount, newBond)
VerifierBondSlashed(verifier, amount, reason)
```

## Derived Tables

- `tasks` — current task state
- `escrows` — locked balances + `isFrozen`
- `disputes` — open/resolved disputes with snapshotted parties and consent flags
- `agents` — aggregated addresses with capabilities (off-chain manifest join)
- `receipts` — receipt hashes + URIs from events + XMTP correlation

## GraphQL Example

```graphql
type Task {
  id: ID!
  poster: String!
  worker: String!
  state: String!
  settlementDigest: String!
  proofs: [Proof!]!
}

type Dispute {
  id: ID!
  taskId: ID!
  snapshotPoster: String!
  snapshotWorker: String!
  proposedArbitrator: String
  posterConsented: Boolean!
  workerConsented: Boolean!
  tier: Int!
  resolutionDeadline: BigInt!
}
```

## Correlation Keys

`(chainId, registryAddress, taskId)` — global task reference

`(negotiationId)` — off-chain XMTP thread (from indexer XMTP plugin)

# Verifier Interface Standard

Enables independent verifier markets without protocol forks.

## Onchain Registration

```solidity
interface IVerifierRegistry {
    function registerVerifier(
        bytes32[] calldata domains,
        uint256 bond
    ) external;

    function attest(
        uint256 taskId,
        uint256 milestoneIndex,
        bytes32 receiptHash,
        bool valid,
        bytes calldata metadata
    ) external;
}
```

## Off-Chain Adapter

Verifiers implement `VerifierAdapter`:

```typescript
interface VerifierAdapter {
  domain: string;
  evaluate(receipt: ExecutionReceipt, criteria: AcceptanceCriteria): Promise<VerificationResult>;
}

interface VerificationResult {
  valid: boolean;
  confidence: number; // 0-1
  evidenceHash: string;
  notes?: string;
}
```

## Domain Tags

Examples: `software.deterministic`, `software.semi`, `legal.subjective`, `media.creative`

Reputation for domain A MUST NOT automatically apply to domain B.

## Quorum Mode

Posters may require `minVerifiers` attestations with `minConfidence` aggregate before auto-release.

## Economic Alignment

Verifier bond slashed on proven false attestation (collusion with worker against poster).

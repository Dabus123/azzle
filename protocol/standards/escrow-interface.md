# Escrow Interface Standard

Any escrow provider or chain implements this interface without changing negotiation logic.

## Interface (Solidity)

```solidity
interface IEscrowVault {
    enum EscrowMode { UPFRONT, MILESTONE, STREAMING, HOUR_BLOCKS }
    enum EscrowState { UNFUNDED, LOCKED, PARTIAL_RELEASE, RELEASED, FROZEN, REFUNDED }

    // Registry-gated deposit only — no public deposit() ([H-2 fix])
    function depositFor(uint256 taskId, uint256 amount) external;
    function releaseMilestone(uint256 taskId, uint256 milestoneIndex) external;
    function streamRelease(uint256 taskId, uint256 amount) external;
    function freeze(uint256 taskId) external;
    function refund(uint256 taskId, address to, uint256 amount) external;
    function split(uint256 taskId, address worker, address poster, uint256 workerBps) external;

    function getEscrowState(uint256 taskId) external view returns (EscrowState);
    function lockedBalance(uint256 taskId) external view returns (uint256);
    function isFrozen(uint256 taskId) external view returns (bool);
}
```

Reference flow: poster approves escrow token **to `EscrowVault`** (not `AgentDepositVault`) → `TaskRegistry.fundTask(taskId, amount)` → `EscrowVault.depositFor`. See [`../TASK_STATE_MACHINE.md`](../TASK_STATE_MACHINE.md#funding-escrow).

## Mode Semantics

| Mode | Behavior |
|------|----------|
| UPFRONT | Full amount locked; single release on completion |
| MILESTONE | Partial amounts per index; independent release |
| STREAMING | Continuous release by `rate × elapsed`; single `totalReleased` baseline ([H-3 fix]) |
| HOUR_BLOCKS | Prepaid discrete hour units consumed by worker claims |

## Swap Requirements

Alternate implementations MUST:

1. Emit standard events (`Deposited`, `MilestoneReleased`, `StreamReleased`, `Frozen`, `Refunded`, `Split`)
2. Honor `taskId` as primary key from `ITaskRegistry`
3. Respect arbitration module freeze signals
4. Reject poster refunds while `FROZEN` (disputed)
5. Support same `EscrowMode` enum values
6. Route all deposits through registry-gated entry (no bypass of balance health checks)

Negotiation layer references mode by string in task schema; clients map to enum on settlement.

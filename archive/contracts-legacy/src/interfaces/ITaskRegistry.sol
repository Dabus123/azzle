// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITaskRegistry {
    enum TaskState {
        DRAFT,
        POSTED,
        CLAIMED,
        ACTIVE,
        IN_REVIEW,
        COMPLETED,
        CANCELLED,
        EXPIRED,
        DISPUTED,
        RESOLVED,
        REPLACING,
        PAUSED,
        DELETED
    }

    struct Task {
        address poster;
        address worker;
        address token;
        uint256 totalAmount;
        uint8 escrowMode;
        bytes32 settlementDigest;
        TaskState state;
        uint256 deadline;
        uint256 createdAt;
        bool replacementAllowed;
        uint256 parentTaskId; // 0 if root task
    }

    event TaskCreated(
        uint256 indexed taskId,
        address indexed poster,
        address indexed worker,
        bytes32 settlementDigest
    );
    event TaskPosted(uint256 indexed taskId, address indexed poster, bytes32 settlementDigest);
    event TaskClaimed(uint256 indexed taskId, address indexed worker);
    event WorkStarted(uint256 indexed taskId);
    event WorkerDismissed(uint256 indexed taskId, address indexed dismissedWorker);
    event WorkerLeft(uint256 indexed taskId, address indexed worker);
    event TaskPaused(uint256 indexed taskId, address indexed culprit, uint256 resumeAt);
    event TaskResumed(uint256 indexed taskId);
    event EmergencyTopUp(uint256 indexed taskId, address indexed agent, uint256 amount);
    event TaskDeleted(uint256 indexed taskId, address indexed culprit);
    event ProofSubmitted(uint256 indexed taskId, uint256 milestoneIndex, bytes32 receiptHash);
    event WorkerReplaced(uint256 indexed taskId, address oldWorker, address newWorker);
    event TaskStateChanged(uint256 indexed taskId, TaskState newState);

    function getTask(uint256 taskId) external view returns (Task memory);
    function taskState(uint256 taskId) external view returns (TaskState);
    function taskCount() external view returns (uint256);

    /// @notice Max USDC withdrawable from AgentDepositVault (keeps per-task minimum when bound)
    function maxWithdrawableDeposit(address agent) external view returns (uint256);

    /// @notice Called by ArbitrationModule after escrow split — terminal dispute state
    function onDisputeResolved(uint256 taskId) external;
}

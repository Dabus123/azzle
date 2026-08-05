// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Escrow Interface Standard — swappable escrow providers
interface IEscrowVault {
    enum EscrowMode {
        UPFRONT,
        MILESTONE,
        STREAMING,
        HOUR_BLOCKS
    }

    enum EscrowState {
        UNFUNDED,
        LOCKED,
        PARTIAL_RELEASE,
        RELEASED,
        FROZEN,
        REFUNDED
    }

    event Deposited(uint256 indexed taskId, address indexed from, uint256 amount);
    event MilestoneReleased(uint256 indexed taskId, uint256 milestoneIndex, uint256 amount);
    event StreamReleased(uint256 indexed taskId, uint256 amount);
    event Frozen(uint256 indexed taskId);
    event Refunded(uint256 indexed taskId, address indexed to, uint256 amount);
    event Split(uint256 indexed taskId, address worker, address poster, uint256 workerAmount, uint256 posterAmount);

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

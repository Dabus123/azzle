// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArbitrationModule {
    enum DisputeState {
        OPEN,
        EVIDENCE,
        RESOLVED
    }

    event DisputeOpened(uint256 indexed disputeId, uint256 indexed taskId, address initiator);
    event ArbitratorProposed(uint256 indexed disputeId, address indexed proposer, address indexed arbitrator);
    event ArbitratorConsented(uint256 indexed disputeId, address indexed consenter, address indexed arbitrator);
    event DisputeResolved(uint256 indexed disputeId, uint256 workerBps);
    event DisputeTimedOut(uint256 indexed disputeId, address indexed triggeredBy);

    function openDispute(uint256 taskId, address initiator, bytes calldata evidenceHash) external returns (uint256 disputeId);
    function proposeArbitrator(uint256 disputeId, address arbitrator) external;
    function resolveDispute(uint256 disputeId, uint256 workerBps) external;
    function resolveTimedOut(uint256 disputeId) external;
    function escalate(uint256 disputeId) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {TreasuryRouter} from "./TreasuryRouter.sol";

/// @title Onchain reputation signals — evidence layer for off-chain aggregation
contract ReputationRegistry is Ownable2Step {
    enum SignalType {
        TASK_COMPLETED,
        TASK_FAILED,
        DISPUTE_WON,
        DISPUTE_LOST,
        PROOF_REJECTED,
        REPLACEMENT_PENALTY,
        VERIFIER_ATTESTATION,
        PEER_ENDORSEMENT,
        ARBITRATOR_STANDBY,
        ARBITRATOR_RESOLVED
    }

    struct Signal {
        address subject;
        SignalType signalType;
        uint256 taskId;
        bytes32 taskTypeHash;
        uint256 weight;
        uint256 timestamp;
        bytes32 payloadHash;
    }

    uint256 public signalCount;
    mapping(uint256 => Signal)         public signals;
    mapping(address => uint256[])      public subjectSignals;
    mapping(address => uint256)        public verifierBond;
    mapping(address => uint256)        public arbitratorReputation;

    address public taskRegistry;
    address public arbitrationModule;
    address public agentDepositVault;
    address public treasury;

    event ReputationSignalEmitted(
        uint256 indexed signalId,
        address indexed subject,
        SignalType signalType,
        uint256 taskId
    );
    event ReputationReset(address indexed subject);
    event VerifierBondStaked(address indexed verifier, uint256 amount, uint256 newBond);
    event VerifierBondUnstaked(address indexed verifier, uint256 amount, uint256 newBond);
    event VerifierBondSlashed(address indexed verifier, uint256 amount, bytes32 reason);

    modifier onlyAuthorized() {
        require(
            msg.sender == taskRegistry ||
                msg.sender == arbitrationModule ||
                msg.sender == agentDepositVault,
            "ReputationRegistry: unauthorized"
        );
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setAuthorized(address _taskRegistry, address _arbitration) external onlyOwner {
        require(taskRegistry == address(0), "ReputationRegistry: set");
        require(
            _taskRegistry != address(0) && _arbitration != address(0),
            "ReputationRegistry: zero"
        );
        taskRegistry = _taskRegistry;
        arbitrationModule = _arbitration;
    }

    function setAgentDepositVault(address _vault) external onlyOwner {
        require(agentDepositVault == address(0), "ReputationRegistry: vault set");
        require(_vault != address(0), "ReputationRegistry: zero");
        agentDepositVault = _vault;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(treasury == address(0), "ReputationRegistry: treasury set");
        require(_treasury != address(0), "ReputationRegistry: zero");
        treasury = _treasury;
    }

    /// @notice Wipe Onchain signal index for subject and forfeit remaining verifier bond.
    function resetSubject(address subject) external onlyAuthorized {
        uint256 bond = verifierBond[subject];
        if (bond > 0 && treasury != address(0)) {
            verifierBond[subject] = 0;
            TreasuryRouter(treasury).recordNativeSlash{value: bond}();
            emit VerifierBondSlashed(subject, bond, bytes32("PLATFORM_PENALTY"));
        }

        delete subjectSignals[subject];
        arbitratorReputation[subject] = 0;
        emit ReputationReset(subject);
    }

    function emitSignal(
        address subject,
        SignalType signalType,
        uint256 taskId,
        bytes32 taskTypeHash,
        uint256 weight,
        bytes32 payloadHash
    ) external onlyAuthorized returns (uint256 signalId) {
        return _recordSignal(subject, signalType, taskId, taskTypeHash, weight, payloadHash);
    }

    function _recordSignal(
        address subject,
        SignalType signalType,
        uint256 taskId,
        bytes32 taskTypeHash,
        uint256 weight,
        bytes32 payloadHash
    ) internal returns (uint256 signalId) {
        signalId = ++signalCount;
        signals[signalId] = Signal({
            subject:      subject,
            signalType:   signalType,
            taskId:       taskId,
            taskTypeHash: taskTypeHash,
            weight:       weight,
            timestamp:    block.timestamp,
            payloadHash:  payloadHash
        });
        subjectSignals[subject].push(signalId);
        emit ReputationSignalEmitted(signalId, subject, signalType, taskId);
    }

    function recordDisputeOutcome(address subject, uint256 taskId, bool won) external {
        require(msg.sender == arbitrationModule, "ReputationRegistry: not arbitration");
        _recordSignal(
            subject,
            won ? SignalType.DISPUTE_WON : SignalType.DISPUTE_LOST,
            taskId,
            bytes32(0),
            100,
            bytes32(0)
        );
    }

    function recordArbitratorRegistration(address agent, uint256 taskId, uint256 points) external {
        require(msg.sender == arbitrationModule, "ReputationRegistry: not arbitration");
        arbitratorReputation[agent] += points;
        _recordSignal(agent, SignalType.ARBITRATOR_STANDBY, taskId, bytes32(0), points, bytes32(0));
    }

    function recordArbitratorResolution(address agent, uint256 taskId, uint256 points) external {
        require(msg.sender == arbitrationModule, "ReputationRegistry: not arbitration");
        arbitratorReputation[agent] += points;
        _recordSignal(agent, SignalType.ARBITRATOR_RESOLVED, taskId, bytes32(0), points, bytes32(0));
    }

    function recordCompletion(address worker, uint256 taskId, bytes32 taskTypeHash)
        external
        onlyAuthorized
    {
        _recordSignal(worker, SignalType.TASK_COMPLETED, taskId, taskTypeHash, 100, bytes32(0));
    }

    function recordReplacementPenalty(address worker, uint256 taskId) external onlyAuthorized {
        _recordSignal(worker, SignalType.REPLACEMENT_PENALTY, taskId, bytes32(0), 200, bytes32(0));
    }

    function stakeVerifierBond() external payable {
        require(msg.value > 0, "ReputationRegistry: zero stake");
        verifierBond[msg.sender] += msg.value;
        emit VerifierBondStaked(msg.sender, msg.value, verifierBond[msg.sender]);
    }

    function unstakeVerifierBond(uint256 amount) external {
        require(amount > 0, "ReputationRegistry: zero unstake");
        require(verifierBond[msg.sender] >= amount, "ReputationRegistry: insufficient bond");
        verifierBond[msg.sender] -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "ReputationRegistry: transfer failed");
        emit VerifierBondUnstaked(msg.sender, amount, verifierBond[msg.sender]);
    }

    function slashVerifierBond(address subject, uint256 amount, bytes32 reason) external {
        require(
            msg.sender == arbitrationModule || msg.sender == taskRegistry,
            "ReputationRegistry: not slash authority"
        );
        require(amount > 0, "ReputationRegistry: zero slash");
        require(verifierBond[subject] >= amount, "ReputationRegistry: insufficient bond");
        require(treasury != address(0), "ReputationRegistry: no treasury");

        verifierBond[subject] -= amount;
        TreasuryRouter(treasury).recordNativeSlash{value: amount}();
        emit VerifierBondSlashed(subject, amount, reason);
    }

    function getSubjectSignalCount(address subject) external view returns (uint256) {
        return subjectSignals[subject].length;
    }
}

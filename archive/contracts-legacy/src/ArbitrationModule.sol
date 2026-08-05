// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IArbitrationModule} from "./interfaces/IArbitrationModule.sol";
import {ITaskRegistry} from "./interfaces/ITaskRegistry.sol";
import {IEscrowVault} from "./interfaces/IEscrowVault.sol";
import {IAgentDepositVault} from "./interfaces/IAgentDepositVault.sol";
import {ReputationRegistry} from "./ReputationRegistry.sol";

/// @title Dispute resolution — deposit-gated arbitrator pool + reputation-weighted tiers
contract ArbitrationModule is IArbitrationModule, Ownable2Step {

    uint256 public constant MAX_TIERS           = 3;
    uint256 public constant REGISTER_REP_POINTS = 10;
    uint256 public constant RESOLVE_REP_POINTS  = 50;
    uint256 public constant MIN_REP_TIER1       = 50;
    uint256 public constant MIN_REP_TIER2       = 200;
    uint256 public constant RESOLUTION_TIMEOUT  = 7 days;
    uint256 public constant REGISTER_COOLDOWN   = 1 days;
    uint256 public constant MIN_RESOLUTIONS_TIER2 = 5;

    struct Dispute {
        uint256 taskId;
        address initiator;
        address snapshotWorker;
        address snapshotPoster;
        DisputeState state;
        uint8 tier;
        address assignedArbitrator;
        bytes32 evidenceHash;
        address proposedArbitrator;
        bool    posterConsented;
        bool    workerConsented;
        uint256 resolutionDeadline;
    }

    uint256 public disputeCount;
    mapping(uint256 => Dispute)                       public disputes;
    mapping(uint256 => mapping(address => bool))      public registeredArbitrator;
    mapping(address => uint256)  public lastRegisteredAt;
    mapping(address => uint256)  public resolvedCount;

    ITaskRegistry      public immutable taskRegistry;
    IEscrowVault       public immutable escrow;
    ReputationRegistry public reputationRegistry;
    IAgentDepositVault public agentDepositVault;
    address public fallbackResolver;

    event ArbitratorRegistered(address indexed arbitrator, uint256 indexed taskId);
    event TierEscalated(uint256 indexed disputeId, uint8 newTier);

    constructor(address _taskRegistry, address _escrow) Ownable(msg.sender) {
        require(_taskRegistry != address(0) && _escrow != address(0), "Arbitration: zero addr");
        taskRegistry = ITaskRegistry(_taskRegistry);
        escrow       = IEscrowVault(_escrow);
    }

    function setReputationRegistry(address _reputation) external onlyOwner {
        require(address(reputationRegistry) == address(0), "Arbitration: reputation set");
        require(_reputation != address(0), "Arbitration: zero");
        reputationRegistry = ReputationRegistry(_reputation);
    }

    function setAgentDepositVault(address _vault) external onlyOwner {
        require(address(agentDepositVault) == address(0), "Arbitration: vault set");
        require(_vault != address(0), "Arbitration: zero");
        agentDepositVault = IAgentDepositVault(_vault);
    }

    function setFallbackResolver(address _resolver) external onlyOwner {
        fallbackResolver = _resolver;
    }

    /// @notice Standby for task disputes — requires $20+ agent deposit; earns reputation.
    function registerArbitrator(uint256 taskId) external {
        require(address(agentDepositVault) != address(0), "Arbitration: no vault");
        require(agentDepositVault.meetsEntryMinimum(msg.sender), "Arbitration: below min deposit");
        require(
            block.timestamp >= lastRegisteredAt[msg.sender] + REGISTER_COOLDOWN,
            "Arbitration: registration cooldown"
        );

        ITaskRegistry.Task memory t = taskRegistry.getTask(taskId);
        require(msg.sender != t.poster && msg.sender != t.worker, "Arbitration: party");
        require(
            t.state == ITaskRegistry.TaskState.POSTED ||
                t.state == ITaskRegistry.TaskState.CLAIMED,
            "Arbitration: task not idle"
        );
        require(!registeredArbitrator[taskId][msg.sender], "Arbitration: already registered");

        registeredArbitrator[taskId][msg.sender] = true;
        lastRegisteredAt[msg.sender] = block.timestamp;

        if (address(reputationRegistry) != address(0)) {
            reputationRegistry.recordArbitratorRegistration(msg.sender, taskId, REGISTER_REP_POINTS);
        }

        emit ArbitratorRegistered(msg.sender, taskId);
    }

    function openDispute(uint256 taskId, address initiator, bytes calldata evidenceHash)
        external
        returns (uint256 disputeId)
    {
        require(msg.sender == address(taskRegistry), "Arbitration: not registry");

        ITaskRegistry.Task memory t = taskRegistry.getTask(taskId);
        require(initiator == t.poster || initiator == t.worker, "Arbitration: not party");

        disputeId = ++disputeCount;
        disputes[disputeId] = Dispute({
            taskId:            taskId,
            initiator:         initiator,
            snapshotWorker:    t.worker,
            snapshotPoster:    t.poster,
            state:             DisputeState.OPEN,
            tier:              _tierForAmount(t.totalAmount),
            assignedArbitrator: address(0),
            evidenceHash:      keccak256(evidenceHash),
            proposedArbitrator: address(0),
            posterConsented:   false,
            workerConsented:   false,
            resolutionDeadline: block.timestamp + RESOLUTION_TIMEOUT
        });

        escrow.freeze(taskId);
        emit DisputeOpened(disputeId, taskId, initiator);
    }

    /// @notice Both parties must call with the same arbitrator address to seat them.
    function proposeArbitrator(uint256 disputeId, address arbitrator) external {
        Dispute storage d = disputes[disputeId];
        require(d.state == DisputeState.OPEN, "Arbitration: not open");
        require(
            msg.sender == d.snapshotPoster || msg.sender == d.snapshotWorker,
            "Arbitration: not party"
        );
        require(arbitrator != address(0), "Arbitration: zero arbitrator");
        require(registeredArbitrator[d.taskId][arbitrator], "Arbitration: not registered for task");
        require(
            address(agentDepositVault) != address(0) &&
                agentDepositVault.meetsEntryMinimum(arbitrator),
            "Arbitration: arbitrator below min deposit"
        );

        uint256 rep = address(reputationRegistry) != address(0)
            ? reputationRegistry.arbitratorReputation(arbitrator)
            : 0;
        if (d.tier == 1) {
            require(rep >= MIN_REP_TIER1, "Arbitration: rep tier1");
        } else if (d.tier >= 2) {
            require(rep >= MIN_REP_TIER2, "Arbitration: rep tier2");
            require(resolvedCount[arbitrator] >= MIN_RESOLUTIONS_TIER2, "Arbitration: insufficient resolutions");
        }

        if (d.proposedArbitrator != arbitrator) {
            d.proposedArbitrator = arbitrator;
            d.posterConsented    = false;
            d.workerConsented    = false;
        }

        if (msg.sender == d.snapshotPoster) {
            d.posterConsented = true;
        } else {
            d.workerConsented = true;
        }

        emit ArbitratorProposed(disputeId, msg.sender, arbitrator);
        emit ArbitratorConsented(disputeId, msg.sender, arbitrator);

        if (d.posterConsented && d.workerConsented) {
            d.assignedArbitrator = arbitrator;
            d.state = DisputeState.EVIDENCE;
            d.resolutionDeadline = block.timestamp + RESOLUTION_TIMEOUT;
        }
    }

    /// @notice Escalate tier while dispute is OPEN (no arbitrator seated yet).
    function escalate(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        require(d.state == DisputeState.OPEN, "Arbitration: can only escalate OPEN disputes");
        require(d.tier < MAX_TIERS, "Arbitration: max tier");
        require(
            msg.sender == d.snapshotPoster || msg.sender == d.snapshotWorker,
            "Arbitration: not party"
        );

        d.tier              += 1;
        d.proposedArbitrator = address(0);
        d.posterConsented    = false;
        d.workerConsented    = false;
        d.resolutionDeadline = block.timestamp + RESOLUTION_TIMEOUT;

        emit TierEscalated(disputeId, d.tier);
    }

    /// @notice Permissionless 50/50 fallback split after resolution deadline.
    function resolveTimedOut(uint256 disputeId) external {
        Dispute storage d = disputes[disputeId];
        require(
            d.state == DisputeState.OPEN || d.state == DisputeState.EVIDENCE,
            "Arbitration: already resolved"
        );
        require(block.timestamp > d.resolutionDeadline, "Arbitration: timeout not reached");

        emit DisputeTimedOut(disputeId, msg.sender);
        _finalise(d, disputeId, 5000);
    }

    function resolveDispute(uint256 disputeId, uint256 workerBps) external {
        Dispute storage d = disputes[disputeId];
        require(msg.sender == d.assignedArbitrator, "Arbitration: not assigned");
        require(d.state == DisputeState.EVIDENCE, "Arbitration: not in evidence");
        require(workerBps <= 10000, "Arbitration: invalid bps");

        resolvedCount[d.assignedArbitrator] += 1;
        _finalise(d, disputeId, workerBps);
    }

    function _finalise(Dispute storage d, uint256 disputeId, uint256 workerBps) internal {
        d.state = DisputeState.RESOLVED;

        escrow.split(d.taskId, d.snapshotWorker, d.snapshotPoster, workerBps);

        if (address(reputationRegistry) != address(0)) {
            bool workerWon = workerBps >= 5000;
            reputationRegistry.recordDisputeOutcome(d.snapshotWorker, d.taskId, workerWon);
            reputationRegistry.recordDisputeOutcome(d.snapshotPoster, d.taskId, !workerWon);
            if (d.assignedArbitrator != address(0)) {
                reputationRegistry.recordArbitratorResolution(
                    d.assignedArbitrator,
                    d.taskId,
                    RESOLVE_REP_POINTS
                );
            }
        }

        emit DisputeResolved(disputeId, workerBps);
        ITaskRegistry(address(taskRegistry)).onDisputeResolved(d.taskId);
    }

    function _tierForAmount(uint256 amount) internal pure returns (uint8) {
        if (amount < 1e6)    return 0;
        if (amount < 100e6)  return 1;
        return 2;
    }
}

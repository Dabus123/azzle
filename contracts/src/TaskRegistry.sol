// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITaskRegistry} from "./interfaces/ITaskRegistry.sol";
import {IEscrowVault} from "./interfaces/IEscrowVault.sol";
import {EscrowVault} from "./EscrowVault.sol";
import {IArbitrationModule} from "./interfaces/IArbitrationModule.sol";
import {TreasuryRouter} from "./TreasuryRouter.sol";
import {AgentDepositVault} from "./AgentDepositVault.sol";

/// @title Canonical task identity and state machine anchor
contract TaskRegistry is ITaskRegistry, Ownable {
    struct TaskPause {
        TaskState resumeState;
        uint256 pauseEndsAt;
        address culprit;
    }

    uint256 public taskCount;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => TaskPause) public taskPauses;
    mapping(uint256 => mapping(uint256 => bytes32)) public proofHashes;
    mapping(uint256 => mapping(uint256 => bool)) public proofSubmitted;
    /// @dev O(1) count of live tasks an agent is bound to (poster or worker)
    mapping(address => uint256) public liveTaskBindings;
    /// @dev Prevents double-unbind when terminal paths overlap
    mapping(uint256 => bool) private _partiesReleased;

    EscrowVault public immutable escrow;
    IArbitrationModule public arbitration;
    address public treasury;
    AgentDepositVault public agentVault;
    uint16 public defaultFeeBps = 100;

    modifier onlyPoster(uint256 taskId) {
        require(tasks[taskId].poster == msg.sender, "TaskRegistry: not poster");
        _;
    }

    modifier onlyWorker(uint256 taskId) {
        require(tasks[taskId].worker == msg.sender, "TaskRegistry: not worker");
        _;
    }

    modifier taskLive(uint256 taskId) {
        require(tasks[taskId].state != TaskState.DELETED, "TaskRegistry: deleted");
        _;
    }

    modifier notPaused(uint256 taskId) {
        require(tasks[taskId].state != TaskState.PAUSED, "TaskRegistry: paused");
        _;
    }

    constructor(address _escrow) Ownable(msg.sender) {
        escrow = EscrowVault(_escrow);
    }

    function setArbitration(address _arbitration) external onlyOwner {
        require(address(arbitration) == address(0), "TaskRegistry: arbitration set");
        require(_arbitration != address(0), "TaskRegistry: zero");
        arbitration = IArbitrationModule(_arbitration);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(treasury == address(0), "TaskRegistry: treasury set");
        require(_treasury != address(0), "TaskRegistry: zero");
        treasury = _treasury;
    }

    function setAgentVault(address _agentVault) external onlyOwner {
        require(address(agentVault) == address(0), "TaskRegistry: vault set");
        require(_agentVault != address(0), "TaskRegistry: zero");
        agentVault = AgentDepositVault(_agentVault);
    }

    function postTask(
        address token,
        uint256 totalAmount,
        IEscrowVault.EscrowMode escrowMode,
        bytes32 settlementDigest,
        uint256 deadline,
        uint256[] calldata milestoneAmounts,
        uint256 streamRate,
        uint256 hourBlockSize
    ) external returns (uint256 taskId) {
        require(treasury != address(0), "TaskRegistry: no treasury");
        require(address(agentVault) != address(0), "TaskRegistry: no vault");
        require(token == agentVault.usdcToken(), "TaskRegistry: token mismatch");

        agentVault.requireBalanceForFee(msg.sender, TreasuryRouter(treasury).ACCESS_FEE());
        agentVault.debitAccessFee(msg.sender, TreasuryRouter.AccessFeeKind.POST);

        taskId = ++taskCount;
        tasks[taskId] = Task({
            poster: msg.sender,
            worker: address(0),
            token: token,
            totalAmount: totalAmount,
            escrowMode: uint8(escrowMode),
            settlementDigest: settlementDigest,
            state: TaskState.POSTED,
            deadline: deadline,
            createdAt: block.timestamp,
            replacementAllowed: true,
            parentTaskId: 0
        });

        escrow.configureTask(
            taskId,
            token,
            msg.sender,
            address(0),
            escrowMode,
            milestoneAmounts,
            streamRate,
            hourBlockSize
        );

        _bindAgent(msg.sender);

        emit TaskPosted(taskId, msg.sender, settlementDigest);
        emit TaskStateChanged(taskId, TaskState.POSTED);
        _enforceBalanceHealth(taskId);
    }

    function claimTask(uint256 taskId) external taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.POSTED, "TaskRegistry: not posted");
        require(t.worker == address(0), "TaskRegistry: already claimed");

        agentVault.requireBalanceForFee(msg.sender, TreasuryRouter(treasury).ACCESS_FEE());
        agentVault.debitAccessFee(msg.sender, TreasuryRouter.AccessFeeKind.CLAIM);

        t.worker = msg.sender;
        t.state = TaskState.CLAIMED;
        escrow.setWorker(taskId, msg.sender);

        _bindAgent(msg.sender);

        emit TaskClaimed(taskId, msg.sender);
        emit TaskStateChanged(taskId, TaskState.CLAIMED);
        _enforceBalanceHealth(taskId);
    }

    function startWork(uint256 taskId) external onlyPoster(taskId) taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.CLAIMED, "TaskRegistry: not claimed");
        t.state = TaskState.ACTIVE;
        emit WorkStarted(taskId);
        emit TaskStateChanged(taskId, TaskState.ACTIVE);
        _enforceBalanceHealth(taskId);
    }

    function dismissWorker(uint256 taskId) external onlyPoster(taskId) taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.CLAIMED, "TaskRegistry: not claimed");
        address dismissed = t.worker;
        require(dismissed != address(0), "TaskRegistry: no worker");

        agentVault.debitDismissFee(msg.sender, dismissed);

        _unbindAgent(dismissed);
        t.worker = address(0);
        t.state = TaskState.POSTED;
        escrow.setWorker(taskId, address(0));

        emit WorkerDismissed(taskId, dismissed);
        emit TaskStateChanged(taskId, TaskState.POSTED);
        _enforceBalanceHealth(taskId);
    }

    function leaveTask(uint256 taskId) external onlyWorker(taskId) taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.CLAIMED, "TaskRegistry: not claimed");

        agentVault.debitLeaveFee(msg.sender, t.poster);

        _unbindAgent(msg.sender);
        t.worker = address(0);
        t.state = TaskState.POSTED;
        escrow.setWorker(taskId, address(0));

        emit WorkerLeft(taskId, msg.sender);
        emit TaskStateChanged(taskId, TaskState.POSTED);
        _enforceBalanceHealth(taskId);
    }

    /// @notice Permissionless balance watchdog — pause, resume, or finalize delete
    function checkTaskBalance(uint256 taskId) external {
        _enforceBalanceHealth(taskId);
    }

    /// @notice During PAUSED: party tops up to restore ≥ $8 in-task balance; auto-resumes if all parties OK
    function emergencyTopUp(uint256 taskId, uint256 amount) external {
        require(address(agentVault) != address(0), "TaskRegistry: no vault");
        Task storage t = tasks[taskId];
        require(t.state == TaskState.PAUSED, "TaskRegistry: not paused");
        require(
            msg.sender == t.poster || msg.sender == t.worker,
            "TaskRegistry: not party"
        );
        require(!agentVault.isBlocked(msg.sender), "TaskRegistry: blocked");
        require(amount > 0, "TaskRegistry: zero amount");

        uint256 required = agentVault.emergencyTopUpRequired(msg.sender);
        require(amount >= required, "TaskRegistry: below emergency min");

        agentVault.pullEmergencyTopUp(msg.sender, amount);

        emit EmergencyTopUp(taskId, msg.sender, amount);
        _enforceBalanceHealth(taskId);
    }

    function createTask(
        address worker,
        address token,
        uint256 totalAmount,
        IEscrowVault.EscrowMode escrowMode,
        bytes32 settlementDigest,
        uint256 deadline,
        bool replacementAllowed,
        uint256[] calldata milestoneAmounts,
        uint256 streamRate,
        uint256 hourBlockSize
    ) external returns (uint256 taskId) {
        if (address(agentVault) != address(0)) {
            agentVault.requireMinimum(msg.sender);
            agentVault.requireMinimum(worker);
        }

        taskId = ++taskCount;
        tasks[taskId] = Task({
            poster: msg.sender,
            worker: worker,
            token: token,
            totalAmount: totalAmount,
            escrowMode: uint8(escrowMode),
            settlementDigest: settlementDigest,
            state: TaskState.ACTIVE,
            deadline: deadline,
            createdAt: block.timestamp,
            replacementAllowed: replacementAllowed,
            parentTaskId: 0
        });

        escrow.configureTask(
            taskId,
            token,
            msg.sender,
            worker,
            escrowMode,
            milestoneAmounts,
            streamRate,
            hourBlockSize
        );

        _bindAgent(msg.sender);
        _bindAgent(worker);

        emit TaskCreated(taskId, msg.sender, worker, settlementDigest);
        emit TaskStateChanged(taskId, TaskState.ACTIVE);
        if (address(agentVault) != address(0)) {
            _enforceBalanceHealth(taskId);
        }
    }

    function fundTask(uint256 taskId, uint256 amount) external onlyPoster(taskId) taskLive(taskId) notPaused(taskId) {
        escrow.depositFor(taskId, amount);
        _enforceBalanceHealth(taskId);
    }

    function submitProof(uint256 taskId, uint256 milestoneIndex, bytes32 receiptHash)
        external
        onlyWorker(taskId)
        taskLive(taskId)
        notPaused(taskId)
    {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.ACTIVE || t.state == TaskState.IN_REVIEW, "TaskRegistry: bad state");
        require(escrow.lockedBalance(taskId) > 0, "TaskRegistry: unfunded");
        require(!proofSubmitted[taskId][milestoneIndex], "TaskRegistry: proof exists");

        proofHashes[taskId][milestoneIndex] = receiptHash;
        proofSubmitted[taskId][milestoneIndex] = true;
        t.state = TaskState.IN_REVIEW;

        emit ProofSubmitted(taskId, milestoneIndex, receiptHash);
        emit TaskStateChanged(taskId, TaskState.IN_REVIEW);
        _enforceBalanceHealth(taskId);
    }

    function acceptMilestone(uint256 taskId, uint256 milestoneIndex)
        external
        onlyPoster(taskId)
        taskLive(taskId)
        notPaused(taskId)
    {
        Task storage t = tasks[taskId];
        require(t.state == TaskState.IN_REVIEW, "TaskRegistry: not in review");
        require(proofSubmitted[taskId][milestoneIndex], "TaskRegistry: no proof");

        escrow.releaseMilestone(taskId, milestoneIndex);
        t.state = TaskState.ACTIVE;
        emit TaskStateChanged(taskId, TaskState.ACTIVE);
        _enforceBalanceHealth(taskId);
    }

    function completeTask(uint256 taskId) external onlyPoster(taskId) taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(
            t.state == TaskState.ACTIVE || t.state == TaskState.IN_REVIEW,
            "TaskRegistry: not completable"
        );
        if (escrow.lockedBalance(taskId) > 0) {
            escrow.releaseRemainingToWorker(taskId);
        }
        _releaseTaskParties(taskId, t);
        t.state = TaskState.COMPLETED;
        emit TaskStateChanged(taskId, TaskState.COMPLETED);
    }

    function onDisputeResolved(uint256 taskId) external {
        require(msg.sender == address(arbitration), "TaskRegistry: not arbitration");
        Task storage t = tasks[taskId];
        require(t.state == TaskState.DISPUTED, "TaskRegistry: not disputed");
        _releaseTaskParties(taskId, t);
        t.state = TaskState.RESOLVED;
        emit TaskStateChanged(taskId, TaskState.RESOLVED);
    }

    function openDispute(uint256 taskId, bytes calldata evidenceHash) external taskLive(taskId) notPaused(taskId) {
        Task storage t = tasks[taskId];
        require(msg.sender == t.poster || msg.sender == t.worker, "TaskRegistry: not party");
        require(t.state == TaskState.IN_REVIEW || t.state == TaskState.ACTIVE, "TaskRegistry: bad state");

        t.state = TaskState.DISPUTED;
        arbitration.openDispute(taskId, msg.sender, evidenceHash);
        emit TaskStateChanged(taskId, TaskState.DISPUTED);
    }

    function requestReplacement(uint256 taskId) external onlyPoster(taskId) {
        revert("TaskRegistry: use dismissWorker");
    }

    function assignReplacementWorker(uint256 taskId, address) external onlyPoster(taskId) {
        revert("TaskRegistry: claim after dismiss");
    }

    /// @notice Expire unfilled or stale tasks after deadline; refunds locked escrow to poster
    function expireTask(uint256 taskId) external taskLive(taskId) {
        Task storage t = tasks[taskId];
        require(block.timestamp > t.deadline, "TaskRegistry: not expired");
        require(
            t.state == TaskState.POSTED ||
                t.state == TaskState.CLAIMED ||
                t.state == TaskState.ACTIVE,
            "TaskRegistry: not expirable"
        );

        if (escrow.lockedBalance(taskId) > 0) {
            escrow.refundRemainingToPoster(taskId);
        }

        _releaseTaskParties(taskId, t);
        t.state = TaskState.EXPIRED;
        emit TaskStateChanged(taskId, TaskState.EXPIRED);
    }

    function getTask(uint256 taskId) external view returns (Task memory) {
        return tasks[taskId];
    }

    function taskState(uint256 taskId) external view returns (TaskState) {
        return tasks[taskId].state;
    }

    /// @inheritdoc ITaskRegistry
    function maxWithdrawableDeposit(address agent) external view returns (uint256) {
        uint256 bal = agentVault.balanceOf(agent);
        if (bal == 0) return 0;
        if (liveTaskBindings[agent] > 0) {
            uint256 floor = agentVault.MIN_TASK_BALANCE();
            if (bal <= floor) return 0;
            return bal - floor;
        }
        return bal;
    }

    function _bindAgent(address agent) internal {
        if (agent != address(0)) {
            liveTaskBindings[agent] += 1;
        }
    }

    function _unbindAgent(address agent) internal {
        if (agent != address(0) && liveTaskBindings[agent] > 0) {
            liveTaskBindings[agent] -= 1;
        }
    }

    function _releaseTaskParties(uint256 taskId, Task storage t) internal {
        if (_partiesReleased[taskId]) return;
        _partiesReleased[taskId] = true;
        _unbindAgent(t.poster);
        _unbindAgent(t.worker);
    }

    function _enforceBalanceHealth(uint256 taskId) internal {
        if (address(agentVault) == address(0)) return;

        Task storage t = tasks[taskId];
        if (t.state == TaskState.DELETED) return;

        if (t.state == TaskState.PAUSED) {
            TaskPause storage p = taskPauses[taskId];
            if (block.timestamp >= p.pauseEndsAt) {
                _finalizePausedTask(taskId);
                return;
            }
            if (_partiesMeetMinimum(t)) {
                t.state = p.resumeState;
                delete taskPauses[taskId];
                emit TaskResumed(taskId);
                emit TaskStateChanged(taskId, t.state);
            }
            return;
        }

        if (!_monitoredState(t.state)) return;

        address culprit = _firstUnderfunded(t);
        if (culprit != address(0)) {
            _enterPause(taskId, culprit);
        }
    }

    function _monitoredState(TaskState s) internal pure returns (bool) {
        return s == TaskState.POSTED ||
            s == TaskState.CLAIMED ||
            s == TaskState.ACTIVE ||
            s == TaskState.IN_REVIEW;
    }

    function _firstUnderfunded(Task storage t) internal view returns (address) {
        if (!agentVault.meetsTaskMinimum(t.poster)) return t.poster;
        if (t.worker != address(0) && !agentVault.meetsTaskMinimum(t.worker)) return t.worker;
        return address(0);
    }

    function _partiesMeetMinimum(Task storage t) internal view returns (bool) {
        if (!agentVault.meetsTaskMinimum(t.poster)) return false;
        if (t.worker != address(0) && !agentVault.meetsTaskMinimum(t.worker)) return false;
        return true;
    }

    function _enterPause(uint256 taskId, address culprit) internal {
        Task storage t = tasks[taskId];
        TaskPause storage p = taskPauses[taskId];
        p.resumeState = t.state;
        p.pauseEndsAt = block.timestamp + agentVault.PAUSE_DURATION();
        p.culprit = culprit;
        t.state = TaskState.PAUSED;
        emit TaskPaused(taskId, culprit, p.pauseEndsAt);
        emit TaskStateChanged(taskId, TaskState.PAUSED);
    }

    function _finalizePausedTask(uint256 taskId) internal {
        Task storage t = tasks[taskId];
        TaskPause storage p = taskPauses[taskId];
        address culprit = p.culprit;

        escrow.refundRemainingToPoster(taskId);
        if (t.worker != address(0)) {
            escrow.setWorker(taskId, address(0));
        }

        _releaseTaskParties(taskId, t);
        t.worker = address(0);
        t.state = TaskState.DELETED;
        delete taskPauses[taskId];

        agentVault.applyPlatformPenalty(culprit);

        emit TaskDeleted(taskId, culprit);
        emit TaskStateChanged(taskId, TaskState.DELETED);
    }
}

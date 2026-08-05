// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IEscrowVault} from "./interfaces/IEscrowVault.sol";

/// @title Escrow primitives: upfront, milestone, streaming, hour-blocks, dispute freeze
contract EscrowVault is IEscrowVault, ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    address public taskRegistry;
    address public arbitrationModule;

    struct EscrowRecord {
        address token;
        address poster;
        address worker;
        EscrowMode mode;
        EscrowState state;
        uint256 totalDeposited;
        uint256 totalReleased;
        uint256 streamRatePerSecond;
        uint256 streamStart;
        uint256 hourBlockSize;
        uint256 hoursClaimed;
    }

    mapping(uint256 => EscrowRecord) public escrows;
    mapping(uint256 => mapping(uint256 => uint256)) public milestoneAmounts;
    mapping(uint256 => mapping(uint256 => bool))    public milestoneReleased;

    modifier onlyRegistry() {
        require(msg.sender == taskRegistry, "EscrowVault: not registry");
        _;
    }

    modifier onlyArbitration() {
        require(msg.sender == arbitrationModule, "EscrowVault: not arbitration");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function setTaskRegistry(address _taskRegistry) external onlyOwner {
        require(taskRegistry == address(0), "EscrowVault: registry set");
        require(_taskRegistry != address(0), "EscrowVault: zero registry");
        taskRegistry = _taskRegistry;
    }

    function setArbitrationModule(address _arbitration) external onlyOwner {
        require(arbitrationModule == address(0), "EscrowVault: arbitration set");
        require(_arbitration != address(0), "EscrowVault: zero arbitration");
        arbitrationModule = _arbitration;
    }

    function setWorker(uint256 taskId, address worker) external onlyRegistry {
        require(escrows[taskId].poster != address(0), "EscrowVault: unknown task");
        escrows[taskId].worker = worker;
    }

    function configureTask(
        uint256 taskId,
        address token,
        address poster,
        address worker,
        EscrowMode mode,
        uint256[] calldata milestones,
        uint256 streamRate,
        uint256 hourBlockSize
    ) external onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.state == EscrowState.UNFUNDED, "EscrowVault: exists");
        e.token           = token;
        e.poster          = poster;
        e.worker          = worker;
        e.mode            = mode;
        e.streamRatePerSecond = streamRate;
        e.hourBlockSize   = hourBlockSize;
        if (mode == EscrowMode.MILESTONE) {
            for (uint256 i = 0; i < milestones.length; i++) {
                milestoneAmounts[taskId][i] = milestones[i];
            }
        }
    }

    /// @notice Called by TaskRegistry after poster approves this contract.
    function depositFor(uint256 taskId, uint256 amount) external nonReentrant onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.poster != address(0), "EscrowVault: unknown task");
        IERC20(e.token).safeTransferFrom(e.poster, address(this), amount);
        _applyDeposit(e, taskId, amount);
    }

    function _applyDeposit(EscrowRecord storage e, uint256 taskId, uint256 amount) internal {
        require(
            e.state == EscrowState.UNFUNDED || e.state == EscrowState.LOCKED,
            "EscrowVault: bad state for deposit"
        );
        e.totalDeposited += amount;
        e.state = EscrowState.LOCKED;
        if (e.mode == EscrowMode.STREAMING && e.streamStart == 0) {
            e.streamStart = block.timestamp;
        }
        emit Deposited(taskId, e.poster, amount);
    }

    function releaseMilestone(uint256 taskId, uint256 milestoneIndex)
        external
        nonReentrant
        onlyRegistry
    {
        EscrowRecord storage e = escrows[taskId];
        require(
            e.state == EscrowState.LOCKED || e.state == EscrowState.PARTIAL_RELEASE,
            "EscrowVault: not locked"
        );
        require(!milestoneReleased[taskId][milestoneIndex], "EscrowVault: released");

        uint256 amount = milestoneAmounts[taskId][milestoneIndex];
        require(amount > 0, "EscrowVault: zero milestone");

        milestoneReleased[taskId][milestoneIndex] = true;
        _releaseToWorker(e, amount);
        emit MilestoneReleased(taskId, milestoneIndex, amount);
    }

    /// @notice Stream release — worker claims accrued stream up to maxAmount.
    function streamRelease(uint256 taskId, uint256 maxAmount) external nonReentrant onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.mode == EscrowMode.STREAMING, "EscrowVault: not streaming");
        require(
            e.state == EscrowState.LOCKED || e.state == EscrowState.PARTIAL_RELEASE,
            "EscrowVault: not locked"
        );
        require(e.streamStart > 0, "EscrowVault: stream not started");

        uint256 elapsed = block.timestamp - e.streamStart;
        uint256 owed    = elapsed * e.streamRatePerSecond;
        if (owed > e.totalDeposited) owed = e.totalDeposited;

        uint256 releasable = owed > e.totalReleased ? owed - e.totalReleased : 0;
        if (maxAmount < releasable) releasable = maxAmount;

        uint256 remaining = e.totalDeposited - e.totalReleased;
        if (releasable > remaining) releasable = remaining;
        require(releasable > 0, "EscrowVault: nothing to stream");

        _releaseToWorker(e, releasable);
        emit StreamReleased(taskId, releasable);
    }

    function claimHourBlock(uint256 taskId) external nonReentrant onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.mode == EscrowMode.HOUR_BLOCKS, "EscrowVault: not hour blocks");
        uint256 amount = e.hourBlockSize;
        require(e.totalReleased + amount <= e.totalDeposited, "EscrowVault: insufficient");
        e.hoursClaimed += 1;
        _releaseToWorker(e, amount);
    }

    function freeze(uint256 taskId) external onlyArbitration {
        escrows[taskId].state = EscrowState.FROZEN;
        emit Frozen(taskId);
    }

    function refund(uint256 taskId, address to, uint256 amount)
        external
        nonReentrant
        onlyArbitration
    {
        EscrowRecord storage e = escrows[taskId];
        require(e.state == EscrowState.FROZEN, "EscrowVault: not frozen");
        uint256 remaining = e.totalDeposited - e.totalReleased;
        require(amount > 0 && amount <= remaining, "EscrowVault: bad refund amount");
        e.totalReleased += amount;
        IERC20(e.token).safeTransfer(to, amount);
        if (e.totalReleased >= e.totalDeposited) {
            e.state = EscrowState.REFUNDED;
        }
        emit Refunded(taskId, to, amount);
    }

    /// @notice Split remaining escrow between worker and poster after dispute resolution.
    function split(uint256 taskId, address worker, address poster, uint256 workerBps)
        external
        nonReentrant
        onlyArbitration
    {
        EscrowRecord storage e = escrows[taskId];
        require(e.state == EscrowState.FROZEN, "EscrowVault: not frozen");
        uint256 remaining = e.totalDeposited - e.totalReleased;
        uint256 toWorker  = (remaining * workerBps) / 10000;
        uint256 toPoster  = remaining - toWorker;
        if (toWorker > 0) IERC20(e.token).safeTransfer(worker, toWorker);
        if (toPoster > 0) IERC20(e.token).safeTransfer(poster, toPoster);
        e.totalReleased = e.totalDeposited;
        e.state = EscrowState.REFUNDED;
        emit Split(taskId, worker, poster, toWorker, toPoster);
    }

    /// @notice Release all remaining locked USDC to worker (completeTask / upfront settlement)
    function releaseRemainingToWorker(uint256 taskId) external nonReentrant onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.worker != address(0), "EscrowVault: no worker");
        require(
            e.state == EscrowState.LOCKED || e.state == EscrowState.PARTIAL_RELEASE,
            "EscrowVault: not releasable"
        );
        uint256 remaining = e.totalDeposited - e.totalReleased;
        if (remaining > 0) {
            _releaseToWorker(e, remaining);
        }
    }

    /// @notice Return locked escrow to poster when task is deleted or expired.
    function refundRemainingToPoster(uint256 taskId) external nonReentrant onlyRegistry {
        EscrowRecord storage e = escrows[taskId];
        require(e.poster != address(0), "EscrowVault: unknown task");
        require(e.state != EscrowState.FROZEN, "EscrowVault: frozen - awaiting arbitration");
        uint256 remaining = e.totalDeposited - e.totalReleased;
        if (remaining > 0) {
            IERC20(e.token).safeTransfer(e.poster, remaining);
            emit Refunded(taskId, e.poster, remaining);
        }
        e.totalReleased = e.totalDeposited;
        e.state = EscrowState.REFUNDED;
    }

    function getEscrowState(uint256 taskId) external view returns (EscrowState) {
        return escrows[taskId].state;
    }

    function lockedBalance(uint256 taskId) external view returns (uint256) {
        EscrowRecord storage e = escrows[taskId];
        return e.totalDeposited - e.totalReleased;
    }

    function isFrozen(uint256 taskId) external view returns (bool) {
        return escrows[taskId].state == EscrowState.FROZEN;
    }

    function _releaseToWorker(EscrowRecord storage e, uint256 amount) internal {
        e.totalReleased += amount;
        if (e.totalReleased >= e.totalDeposited) {
            e.state = EscrowState.RELEASED;
        } else {
            e.state = EscrowState.PARTIAL_RELEASE;
        }
        IERC20(e.token).safeTransfer(e.worker, amount);
    }
}

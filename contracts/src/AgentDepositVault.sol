// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ITaskRegistry} from "./interfaces/ITaskRegistry.sol";
import {TreasuryRouter} from "./TreasuryRouter.sol";
import {ReputationRegistry} from "./ReputationRegistry.sol";

/// @title Agent USDC deposit ledger — minimum balance, access-fee debits, platform blocks
contract AgentDepositVault is Ownable2Step {
    using SafeERC20 for IERC20;

    uint256 public constant MIN_ENTRY_BALANCE  = 20_000_000; // $20 to post / claim
    uint256 public constant MIN_TASK_BALANCE   =  8_000_000; // $8 per live task binding
    uint256 public constant PAUSE_DURATION     = 15 minutes;
    uint256 public constant PLATFORM_BLOCK_DURATION = 7 days;

    address public immutable usdcToken;

    address public taskRegistry;
    address public treasury;
    address public reputationRegistry;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public blockedUntil;

    event ToppedUp(address indexed agent, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed agent, uint256 amount, uint256 newBalance);
    event EmergencyTopUp(address indexed agent, uint256 amount, uint256 newBalance);
    event AccessFeeDebited(address indexed agent, uint256 amount, TreasuryRouter.AccessFeeKind kind);
    event PlatformBlocked(address indexed agent, uint256 until);
    event CompensationCredited(address indexed agent, uint256 amount);
    event Wired(address taskRegistry, address treasury, address reputationRegistry);

    modifier onlyRegistry() {
        require(msg.sender == taskRegistry, "AgentDeposit: not registry");
        _;
    }

    constructor(address _usdcToken) Ownable(msg.sender) {
        require(_usdcToken != address(0), "AgentDeposit: zero usdc");
        usdcToken = _usdcToken;
    }

    /// @notice Wire registry, treasury, and reputation. Re-wire allowed only while vault holds no funds.
    function wire(
        address _taskRegistry,
        address _treasury,
        address _reputationRegistry
    ) external onlyOwner {
        require(
            _taskRegistry != address(0) &&
                _treasury != address(0) &&
                _reputationRegistry != address(0),
            "AgentDeposit: zero addr"
        );
        if (taskRegistry != address(0)) {
            require(
                IERC20(usdcToken).balanceOf(address(this)) == 0,
                "AgentDeposit: live funds - cannot re-wire"
            );
        }
        taskRegistry = _taskRegistry;
        treasury = _treasury;
        reputationRegistry = _reputationRegistry;
        emit Wired(_taskRegistry, _treasury, _reputationRegistry);
    }

    function topUp(uint256 amount) external {
        require(amount > 0, "AgentDeposit: zero amount");
        require(blockedUntil[msg.sender] <= block.timestamp, "AgentDeposit: blocked");
        IERC20(usdcToken).safeTransferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += amount;
        emit ToppedUp(msg.sender, amount, deposits[msg.sender]);
    }

    /// @notice Withdraw USDC; max amount governed by TaskRegistry.maxWithdrawableDeposit().
    function withdraw(uint256 amount) external {
        require(blockedUntil[msg.sender] <= block.timestamp, "AgentDeposit: blocked");
        require(taskRegistry != address(0), "AgentDeposit: not wired");
        require(amount > 0, "AgentDeposit: zero amount");
        uint256 maxW = ITaskRegistry(taskRegistry).maxWithdrawableDeposit(msg.sender);
        require(amount <= maxW, "AgentDeposit: exceeds withdrawable");
        deposits[msg.sender] -= amount;
        IERC20(usdcToken).safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, deposits[msg.sender]);
    }

    /// @notice Pull USDC from agent wallet — called by TaskRegistry during emergency top-up.
    function pullEmergencyTopUp(address agent, uint256 amount) external onlyRegistry {
        require(amount > 0, "AgentDeposit: zero amount");
        require(blockedUntil[agent] <= block.timestamp, "AgentDeposit: blocked");
        IERC20(usdcToken).safeTransferFrom(agent, address(this), amount);
        deposits[agent] += amount;
        emit EmergencyTopUp(agent, amount, deposits[agent]);
    }

    function emergencyTopUpRequired(address agent) external view returns (uint256) {
        if (deposits[agent] >= MIN_TASK_BALANCE) return 0;
        return MIN_TASK_BALANCE - deposits[agent];
    }

    function balanceOf(address agent) external view returns (uint256) {
        return deposits[agent];
    }

    function isBlocked(address agent) public view returns (bool) {
        return blockedUntil[agent] > block.timestamp;
    }

    function meetsTaskMinimum(address agent) public view returns (bool) {
        return deposits[agent] >= MIN_TASK_BALANCE && !isBlocked(agent);
    }

    function meetsEntryMinimum(address agent) public view returns (bool) {
        return deposits[agent] >= MIN_ENTRY_BALANCE && !isBlocked(agent);
    }

    function requireBalanceForFee(address agent, uint256 feeAmount) external view {
        require(!isBlocked(agent), "AgentDeposit: blocked");
        require(
            deposits[agent] >= MIN_ENTRY_BALANCE + feeAmount,
            "AgentDeposit: below min+fee"
        );
    }

    function requireMinimum(address agent) external view {
        require(meetsEntryMinimum(agent), "AgentDeposit: below min 20 USDC");
    }

    /// @notice Debit ACCESS_FEE from ledger, transfer USDC to treasury, collect AZZLE from wallet.
    function debitAccessFee(
        address agent,
        TreasuryRouter.AccessFeeKind kind
    ) external onlyRegistry {
        uint256 fee = TreasuryRouter(treasury).ACCESS_FEE();
        require(deposits[agent] >= MIN_ENTRY_BALANCE + fee, "AgentDeposit: below min+fee");
        deposits[agent] -= fee;
        IERC20(usdcToken).safeTransfer(treasury, fee);
        TreasuryRouter(treasury).recordAccessFee(usdcToken, fee, kind, agent);
        TreasuryRouter(treasury).collectAzlAccessFee(agent, kind);
        emit AccessFeeDebited(agent, fee, kind);
    }

    /// @notice Poster dismisses worker — $2.50 USDC to worker, $2.50 to treasury.
    function debitDismissFee(address poster, address worker) external onlyRegistry {
        uint256 fee          = TreasuryRouter(treasury).ACCESS_FEE();
        uint256 comp         = TreasuryRouter(treasury).EXIT_PARTY_COMP();
        uint256 protocolShare = TreasuryRouter(treasury).EXIT_PROTOCOL_SHARE();

        require(comp + protocolShare == fee, "AgentDeposit: fee invariant violated");

        require(deposits[poster] >= MIN_ENTRY_BALANCE + fee, "AgentDeposit: below min+fee");
        deposits[poster] -= fee;

        IERC20(usdcToken).safeTransfer(worker, comp);
        IERC20(usdcToken).safeTransfer(treasury, protocolShare);

        TreasuryRouter(treasury).recordAccessFee(
            usdcToken,
            protocolShare,
            TreasuryRouter.AccessFeeKind.DISMISS_SEARCH,
            poster
        );
        TreasuryRouter(treasury).collectAzlAccessFee(
            poster,
            TreasuryRouter.AccessFeeKind.DISMISS_SEARCH
        );
        emit CompensationCredited(worker, comp);
    }

    /// @notice Worker leaves — $2.50 USDC to poster, $2.50 to treasury.
    function debitLeaveFee(address worker, address poster) external onlyRegistry {
        uint256 fee          = TreasuryRouter(treasury).ACCESS_FEE();
        uint256 comp         = TreasuryRouter(treasury).EXIT_PARTY_COMP();
        uint256 protocolShare = TreasuryRouter(treasury).EXIT_PROTOCOL_SHARE();

        require(comp + protocolShare == fee, "AgentDeposit: fee invariant violated");

        require(deposits[worker] >= MIN_ENTRY_BALANCE + fee, "AgentDeposit: below min+fee");
        deposits[worker] -= fee;

        IERC20(usdcToken).safeTransfer(poster, comp);
        IERC20(usdcToken).safeTransfer(treasury, protocolShare);

        TreasuryRouter(treasury).recordAccessFee(
            usdcToken,
            protocolShare,
            TreasuryRouter.AccessFeeKind.WORKER_LEAVE,
            worker
        );
        TreasuryRouter(treasury).collectAzlAccessFee(
            worker,
            TreasuryRouter.AccessFeeKind.WORKER_LEAVE
        );
        emit CompensationCredited(poster, comp);
    }

    function applyPlatformPenalty(address agent) external onlyRegistry {
        blockedUntil[agent] = block.timestamp + PLATFORM_BLOCK_DURATION;
        emit PlatformBlocked(agent, blockedUntil[agent]);
        if (reputationRegistry != address(0)) {
            ReputationRegistry(reputationRegistry).resetSubject(agent);
        }
    }
}

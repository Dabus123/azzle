// SPDX-License-Identifier: MIT

//########################################################################################
//########################################################################################
//########################################################################################
//########################################################################################
//########################################.      .########################################
//######################################-          .######################################
//#####################################.            .#####################################
//###############################.+###.              .####-.##############################
//##############################.  ##.                .##-  -#############################
//################################+#.                  .####-#############################
//############################-####.                    .-################################
//##########################-#####.                     .######-##########################
//###############################.          .##-       .+ .######+-#######################
//######################   #####.           ####+     --   .#####   ######################
//##########################+##.          .######- .--      .##+##########################
//############################.           #######+.          .############################
//#############444###########.          .#######.##-          .###########111#############
//##########################.          .#######-####-          .##########################
//#########################.          .-.###.   -##+.-          .#########################
//########################.          .#####.     ######          .########################
//#######################.          .######-    .#######          .#######################
//######################-          .#############+#######          .######################
//#####################.          .######+################          .#####################
//####################-          .#####-############+######          .####################
//###################.          .#####################-#####          .###################
//##################-          .##.  .################-  .###          .##################
//##################         .######+###################+#####.         #GENTIC#LABOR#####
//########################################################################################
//#################AZZLE.ORG##############################################################
//#################SMART#CONTRACT#SUITE###################################################
//##########################. .. .########################################################
//##################..-##..#####. ########################################################
//###################..#. #####. #########################################################
//####################   ####. .##########################################################
//#####################.+###......########################################################
//########################################################################################
//########################################################################################

pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {V2Ownable2Step} from "./access/V2Ownable2Step.sol";
import {IAzlV2Policy} from "./interfaces/IAzlV2Policy.sol";

interface ITreasuryRevenueV2 {
    function recordRevenue(uint256 amount) external;
    function vault() external view returns (address);
}

contract AgentDepositVaultV2 is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct TaskReservation {
        uint256 amount;
        uint256 exitCompensation;
        uint256 exitProtocolShare;
        uint256 accessCompensation;
    }

    IERC20 public immutable azl;
    IAzlV2Policy public immutable policy;
    address public gateway;
    address public registry;
    address public arbitration;
    address public treasury;

    mapping(address => uint256) public deposits;
    mapping(address => uint256) public reserved;
    mapping(address => uint256) public activeTaskReservations;
    mapping(address => uint256) public latchedEntryFloor;
    mapping(uint256 => IAzlV2Policy.TaskQuote) public taskQuotes;
    mapping(uint256 => mapping(address => TaskReservation)) public taskReservations;
    mapping(address => uint256) public pendingPayouts;
    uint256 public totalDeposits;
    uint256 public totalReserved;
    uint256 public totalPendingPayouts;

    event Configured(address indexed gateway, address indexed registry, address indexed arbitration, address treasury);
    event Credited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, address indexed recipient, uint256 amount);
    event Reserved(uint256 indexed taskId, address indexed account, uint256 amount);
    event ReservationReleased(uint256 indexed taskId, address indexed account, uint256 amount);
    event AccessFeeDebited(address indexed account, uint256 amount);
    event ExitFeeDebited(uint256 indexed taskId, address indexed account, address indexed harmed, uint256 compensation, uint256 protocolShare);
    event PayoutDeferred(address indexed recipient, uint256 amount);
    event PayoutClaimed(address indexed account, address indexed recipient, uint256 amount);
    event SurplusRescued(address indexed recipient, uint256 amount);

    modifier onlyGateway() { require(msg.sender == gateway, "ADv2: gateway"); _; }
    modifier onlyRegistry() { require(msg.sender == registry, "ADv2: registry"); _; }
    /// @dev Reserved for future arbitration-facing deposit hooks; currently unused — registry mediates exit fees.
    modifier onlyArbitration() { require(msg.sender == arbitration, "ADv2: arbitration"); _; }

    constructor(address _azl, address _policy, address initialOwner) V2Ownable2Step(initialOwner) {
        require(_azl.code.length != 0 && _policy.code.length != 0, "ADv2: config");
        azl = IERC20(_azl);
        policy = IAzlV2Policy(_policy);
    }

    /// @dev One-shot graph wiring; misconfiguration before `validateGraph()` is permanent.
    function configure(address _gateway, address _registry, address _arbitration, address _treasury) external onlyOwner {
        require(gateway == address(0), "ADv2: configured");
        require(_gateway.code.length != 0 && _registry.code.length != 0 && _arbitration.code.length != 0 && _treasury.code.length != 0, "ADv2: config");
        gateway = _gateway;
        registry = _registry;
        arbitration = _arbitration;
        treasury = _treasury;
        emit Configured(_gateway, _registry, _arbitration, _treasury);
    }

    function validateGraph() external view returns (bool) {
        require(gateway != address(0) && registry != address(0) && arbitration != address(0) && treasury != address(0), "ADv2: graph");
        require(ITreasuryRevenueV2(treasury).vault() == address(this), "ADv2: treasury link");
        return true;
    }

    function credit(address account, uint256 amount, bytes32) external onlyGateway nonReentrant {
        require(account != address(0) && amount > 0, "ADv2: credit");
        require(azl.balanceOf(address(this)) >= liabilities() + amount, "ADv2: unfunded");
        deposits[account] += amount;
        totalDeposits += amount;
        emit Credited(account, amount);
    }

    function available(address account) public view returns (uint256) {
        uint256 held = deposits[account];
        uint256 locked = reserved[account];
        return held > locked ? held - locked : 0;
    }

    function withdrawable(address account) public view returns (uint256) {
        uint256 free = available(account);
        uint256 floor = activeTaskReservations[account] == 0 ? 0 : latchedEntryFloor[account];
        return free > floor ? free - floor : 0;
    }

    function withdraw(uint256 amount, address recipient) external nonReentrant {
        require(recipient != address(0) && amount > 0 && amount <= withdrawable(msg.sender), "ADv2: withdraw");
        deposits[msg.sender] -= amount;
        totalDeposits -= amount;
        _safeTransferExact(recipient, amount);
        emit Withdrawn(msg.sender, recipient, amount);
    }

    /// @notice Atomically reserves task collateral and charges the task-latched access fee.
    /// @dev The poster creates the quote; every later party reuses that exact quote.
    ///      `latchedEntryFloor` applies for the active reservation streak and clears when the last
    ///      task reservation for the account is released (not per individual task completion).
    function reserveTask(uint256 taskId, address account, bool waiveAccessFee, bool createQuote)
        external
        onlyRegistry
        nonReentrant
        returns (uint256 fee)
    {
        require(taskId != 0 && account != address(0), "ADv2: reserve");
        IAzlV2Policy.TaskQuote memory quote = taskQuotes[taskId];
        if (createQuote) {
            require(quote.liveTaskReserve == 0, "ADv2: quoted");
            quote = policy.quoteTask();
            taskQuotes[taskId] = quote;
        } else {
            require(quote.liveTaskReserve > 0, "ADv2: unquoted");
        }
        require(
            quote.entryDeposit > 0 && quote.liveTaskReserve > 0 && quote.accessFee > 0,
            "ADv2: quote"
        );
        require(
            quote.exitCompensation + quote.exitProtocolShare <= quote.liveTaskReserve,
            "ADv2: exit exceeds reserve"
        );
        require(quote.accessFee <= quote.liveTaskReserve, "ADv2: access exceeds reserve");
        require(taskReservations[taskId][account].amount == 0, "ADv2: reserved");
        uint256 entryFloor = latchedEntryFloor[account];
        if (quote.entryDeposit > entryFloor) entryFloor = quote.entryDeposit;
        fee = waiveAccessFee ? 0 : quote.accessFee;
        require(available(account) >= entryFloor + quote.liveTaskReserve + fee, "ADv2: collateral");
        latchedEntryFloor[account] = entryFloor;
        taskReservations[taskId][account] = TaskReservation(
            quote.liveTaskReserve, quote.exitCompensation, quote.exitProtocolShare, quote.accessFee
        );
        activeTaskReservations[account]++;
        reserved[account] += quote.liveTaskReserve;
        totalReserved += quote.liveTaskReserve;
        emit Reserved(taskId, account, quote.liveTaskReserve);
        if (fee > 0) {
            deposits[account] -= fee;
            totalDeposits -= fee;
            if (_payOrDefer(treasury, fee)) ITreasuryRevenueV2(treasury).recordRevenue(fee);
            emit AccessFeeDebited(account, fee);
        }
    }

    function releaseTask(uint256 taskId, address account) external onlyRegistry {
        require(taskId != 0 && account != address(0), "ADv2: release");
        _releaseTask(taskId, account);
    }

    function canResolveTask(
        uint256 taskId,
        address poster,
        address worker,
        address defaulter,
        address harmed
    ) external view returns (bool) {
        if (taskId == 0 || poster == address(0) || worker == address(0)
            || taskReservations[taskId][poster].amount == 0 || taskReservations[taskId][worker].amount == 0) {
            return false;
        }
        if (defaulter == address(0)) return true;
        TaskReservation storage reservation = taskReservations[taskId][defaulter];
        uint256 fee = reservation.exitCompensation + reservation.exitProtocolShare;
        return harmed != address(0) && harmed != defaulter && reservation.amount > 0 && fee > 0
            && fee <= reservation.amount && deposits[defaulter] >= fee;
    }

    /// @notice Consumes the task-latched exit charge from the defaulter before unlocking the remainder.
    function debitExitFee(uint256 taskId, address account, address harmed) external onlyRegistry nonReentrant {
        TaskReservation memory reservation = taskReservations[taskId][account];
        uint256 fee = reservation.exitCompensation + reservation.exitProtocolShare;
        require(harmed != address(0) && reservation.amount > 0 && fee > 0, "ADv2: exit");
        require(fee <= reservation.amount && deposits[account] >= fee, "ADv2: exit funds");

        delete taskReservations[taskId][account];
        reserved[account] -= reservation.amount;
        totalReserved -= reservation.amount;
        _decrementReservationCount(account);
        deposits[account] -= fee;
        totalDeposits -= fee;

        _payOrDefer(harmed, reservation.exitCompensation);
        if (
            reservation.exitProtocolShare > 0
                && _payOrDefer(treasury, reservation.exitProtocolShare)
        ) {
            ITreasuryRevenueV2(treasury).recordRevenue(reservation.exitProtocolShare);
        }
        emit ExitFeeDebited(taskId, account, harmed, reservation.exitCompensation, reservation.exitProtocolShare);
        emit ReservationReleased(taskId, account, reservation.amount);
    }

    /// @notice Transfers an access fee directly to a harmed worker after a poster expiry.
    /// @dev Design clarification: debits `accessCompensation` from the account's free deposits
    ///      independently of the treasury-bound access fee already charged at `reserveTask()`.
    ///      Action Credit usage waives the treasury fee but not this compensation debit — the two
    ///      serve different purposes (protocol revenue vs. harmed-party compensation on default) and
    ///      are intentionally not mutually exclusive. Confirmed by V2FeeLatching.t.sol / V2Lifecycle.t.sol.
    function debitAccessFeeTo(uint256 taskId, address account, address recipient)
        external
        onlyRegistry
        nonReentrant
        returns (uint256 fee)
    {
        TaskReservation memory reservation = taskReservations[taskId][account];
        fee = reservation.accessCompensation;
        require(
            recipient != address(0) && recipient != account
                && fee > 0 && fee <= reservation.amount && deposits[account] >= fee,
            "ADv2: fee"
        );
        delete taskReservations[taskId][account];
        reserved[account] -= reservation.amount;
        totalReserved -= reservation.amount;
        _decrementReservationCount(account);
        deposits[account] -= fee;
        totalDeposits -= fee;
        _payOrDefer(recipient, fee);
        emit AccessFeeDebited(account, fee);
        emit ReservationReleased(taskId, account, reservation.amount);
    }

    /// @notice Pull deferred AZL owed to `msg.sender`. Treasury callers must use `recipient == treasury`
    ///      to trigger `recordRevenue` — deferred access/exit fees skip immediate revenue recording.
    function claimPayout(address recipient) external nonReentrant {
        uint256 amount = pendingPayouts[msg.sender];
        require(recipient != address(0) && amount > 0, "ADv2: payout");
        pendingPayouts[msg.sender] = 0;
        totalPendingPayouts -= amount;
        if (msg.sender == treasury) require(recipient == treasury, "ADv2: treasury recipient");
        _safeTransferExact(recipient, amount);
        if (msg.sender == treasury) ITreasuryRevenueV2(treasury).recordRevenue(amount);
        emit PayoutClaimed(msg.sender, recipient, amount);
    }

    function liabilities() public view returns (uint256) { return totalDeposits + totalPendingPayouts; }

    function rescueSurplus(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0) && amount > 0, "ADv2: surplus");
        require(azl.balanceOf(address(this)) >= liabilities() + amount, "ADv2: surplus funds");
        _safeTransferExact(recipient, amount);
        emit SurplusRescued(recipient, amount);
    }

    function _releaseTask(uint256 taskId, address account) internal {
        uint256 amount = taskReservations[taskId][account].amount;
        if (amount == 0) return;
        delete taskReservations[taskId][account];
        reserved[account] -= amount;
        totalReserved -= amount;
        _decrementReservationCount(account);
        emit ReservationReleased(taskId, account, amount);
    }

    /// @dev Clears entry floor only when the account has no remaining active task reservations.
    function _decrementReservationCount(address account) private {
        uint256 count = activeTaskReservations[account];
        require(count > 0, "ADv2: reservation count");
        unchecked { activeTaskReservations[account] = count - 1; }
        if (count == 1) delete latchedEntryFloor[account];
    }

    /// @dev Standard AZL (no fee-on-transfer, no rebasing). Failed exact transfer defers to `pendingPayouts`.
    ///      When `paid == false`, caller must not call `recordRevenue` until recipient pulls via `claimPayout`.
    function _payOrDefer(address recipient, uint256 amount) internal returns (bool paid) {
        if (amount == 0) return true;
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        (bool ok, bytes memory returned) = address(azl).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool validReturn = returned.length == 0 || (returned.length == 32 && abi.decode(returned, (bool)));
        uint256 afterBalance = azl.balanceOf(address(this));
        uint256 recipientAfter = azl.balanceOf(recipient);
        if (!ok || !validReturn || beforeBalance < afterBalance || beforeBalance - afterBalance != amount
            || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount) {
            require(afterBalance == beforeBalance && recipientAfter == recipientBefore, "ADv2: unsafe transfer");
            pendingPayouts[recipient] += amount;
            totalPendingPayouts += amount;
            emit PayoutDeferred(recipient, amount);
            return false;
        }
        return true;
    }

    /// @dev Requires standard AZL transfer semantics (exact balance deltas).
    function _safeTransferExact(address recipient, uint256 amount) internal {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        azl.safeTransfer(recipient, amount);
        require(beforeBalance - azl.balanceOf(address(this)) == amount
            && azl.balanceOf(recipient) - recipientBefore == amount, "ADv2: transfer delta");
    }
}

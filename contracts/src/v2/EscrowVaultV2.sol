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

/// @notice Task escrow for AZL job payments.
/// @dev Happy path: registry `fund`/`release`/`refund`/`close`. Disputes: registry freezes via arbitration
///      `openDispute`; only arbitration `settle` splits frozen escrow. Registry never calls `settle`.
contract EscrowVaultV2 is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum State { NONE, FUNDED, FROZEN, SETTLED }
    struct Escrow { address poster; address worker; uint256 deposited; uint256 released; State state; }

    IERC20 public immutable azl;
    address public registry;
    address public arbitration;
    mapping(uint256 => Escrow) public escrows;
    mapping(address => uint256) public pendingPayouts;
    uint256 public totalLiabilities;

    event Configured(address indexed registry, address indexed arbitration);
    event EscrowCreated(uint256 indexed taskId, address indexed poster, address indexed worker);
    event Funded(uint256 indexed taskId, address indexed poster, uint256 amount);
    event Released(uint256 indexed taskId, address indexed worker, uint256 amount);
    event Refunded(uint256 indexed taskId, address indexed poster, uint256 amount);
    event Frozen(uint256 indexed taskId);
    event PayoutDeferred(address indexed recipient, uint256 amount);
    event PayoutClaimed(address indexed account, address indexed recipient, uint256 amount);
    event SurplusRescued(address indexed recipient, uint256 amount);

    modifier onlyRegistry() { require(msg.sender == registry, "Ev2: registry"); _; }
    modifier onlyArbitration() { require(msg.sender == arbitration, "Ev2: arbitration"); _; }

    constructor(address _azl, address initialOwner) V2Ownable2Step(initialOwner) {
        require(_azl.code.length != 0, "Ev2: azl");
        azl = IERC20(_azl);
    }

    /// @dev One-shot registry/arbitration wiring.
    function configure(address _registry, address _arbitration) external onlyOwner {
        require(registry == address(0), "Ev2: configured");
        require(_registry.code.length != 0 && _arbitration.code.length != 0, "Ev2: config");
        registry = _registry;
        arbitration = _arbitration;
        emit Configured(_registry, _arbitration);
    }

    function validateGraph() external view returns (bool) {
        require(registry != address(0) && arbitration != address(0), "Ev2: graph");
        return true;
    }

    function create(uint256 taskId, address poster, address worker) external onlyRegistry {
        require(taskId != 0 && escrows[taskId].state == State.NONE && poster != address(0) && worker != address(0), "Ev2: create");
        escrows[taskId] = Escrow(poster, worker, 0, 0, State.FUNDED);
        emit EscrowCreated(taskId, poster, worker);
    }

    function fund(uint256 taskId, uint256 amount) external onlyRegistry nonReentrant {
        Escrow storage e = escrows[taskId];
        require(e.state == State.FUNDED && amount > 0, "Ev2: fund");
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 posterBefore = azl.balanceOf(e.poster);
        azl.safeTransferFrom(e.poster, address(this), amount);
        require(azl.balanceOf(address(this)) - beforeBalance == amount
            && posterBefore - azl.balanceOf(e.poster) == amount, "Ev2: transfer");
        e.deposited += amount;
        totalLiabilities += amount;
        emit Funded(taskId, e.poster, amount);
    }

    function freeze(uint256 taskId) external onlyArbitration {
        Escrow storage e = escrows[taskId];
        require(e.state == State.FUNDED, "Ev2: freeze");
        e.state = State.FROZEN;
        emit Frozen(taskId);
    }

    function release(uint256 taskId, uint256 amount) external onlyRegistry nonReentrant {
        Escrow storage e = escrows[taskId];
        require(e.state == State.FUNDED && amount > 0 && amount <= e.deposited - e.released, "Ev2: release");
        e.released += amount;
        totalLiabilities -= amount;
        _payOrDefer(e.worker, amount);
        emit Released(taskId, e.worker, amount);
    }

    function canSettle(uint256 taskId) external view returns (bool) {
        Escrow storage e = escrows[taskId];
        return taskId != 0 && e.state == State.FROZEN && e.poster != address(0) && e.worker != address(0)
            && e.released <= e.deposited;
    }

    function close(uint256 taskId) external onlyRegistry {
        Escrow storage e = escrows[taskId];
        require(e.state == State.FUNDED && e.released == e.deposited, "Ev2: close");
        e.state = State.SETTLED;
    }

    /// @dev Only arbitration; invoked by `ArbitrationModuleV2` before `TaskRegistryV2.resolveDispute`.
    function settle(uint256 taskId, uint16 workerBps) external onlyArbitration nonReentrant {
        require(workerBps <= 10_000, "Ev2: bps");
        Escrow storage e = escrows[taskId];
        require(e.state == State.FROZEN, "Ev2: settle");
        uint256 remaining = e.deposited - e.released;
        uint256 workerAmount = (remaining * workerBps) / 10_000;
        uint256 posterAmount = remaining - workerAmount;
        e.released = e.deposited;
        e.state = State.SETTLED;
        totalLiabilities -= remaining;
        _payOrDefer(e.worker, workerAmount);
        _payOrDefer(e.poster, posterAmount);
        emit Released(taskId, e.worker, workerAmount);
        emit Refunded(taskId, e.poster, posterAmount);
    }

    function refund(uint256 taskId) external onlyRegistry nonReentrant {
        Escrow storage e = escrows[taskId];
        require(e.state == State.FUNDED, "Ev2: refund");
        uint256 amount = e.deposited - e.released;
        e.released = e.deposited;
        e.state = State.SETTLED;
        totalLiabilities -= amount;
        _payOrDefer(e.poster, amount);
        emit Refunded(taskId, e.poster, amount);
    }

    function claimPayout(address recipient) external nonReentrant {
        uint256 amount = pendingPayouts[msg.sender];
        require(recipient != address(0) && amount > 0, "Ev2: payout");
        pendingPayouts[msg.sender] = 0;
        totalLiabilities -= amount;
        _safeTransferExact(recipient, amount);
        emit PayoutClaimed(msg.sender, recipient, amount);
    }

    function rescueSurplus(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0) && amount > 0, "Ev2: surplus");
        require(azl.balanceOf(address(this)) >= totalLiabilities + amount, "Ev2: surplus funds");
        _safeTransferExact(recipient, amount);
        emit SurplusRescued(recipient, amount);
    }

    function _payOrDefer(address recipient, uint256 amount) internal {
        if (amount == 0) return;
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        (bool ok, bytes memory data) = address(azl).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool validReturn = data.length == 0 || (data.length == 32 && abi.decode(data, (bool)));
        uint256 afterBalance = azl.balanceOf(address(this));
        uint256 recipientAfter = azl.balanceOf(recipient);
        if (!ok || !validReturn || beforeBalance < afterBalance || beforeBalance - afterBalance != amount
            || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount) {
            require(afterBalance == beforeBalance && recipientAfter == recipientBefore, "Ev2: unsafe transfer");
            pendingPayouts[recipient] += amount;
            totalLiabilities += amount;
            emit PayoutDeferred(recipient, amount);
        }
    }

    function _safeTransferExact(address recipient, uint256 amount) internal {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        azl.safeTransfer(recipient, amount);
        require(beforeBalance - azl.balanceOf(address(this)) == amount
            && azl.balanceOf(recipient) - recipientBefore == amount, "Ev2: transfer delta");
    }
}

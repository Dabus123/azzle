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

interface IArbitrationPanelGuardV2 {
    function hasEligiblePanelMemberExcluding(address excluded) external view returns (bool);
}

interface ITreasuryBondRevenueV2 {
    function recordBondSlashRevenue(uint256 amount) external;
}

interface IArbitrationBondLink {
    function bonds() external view returns (address);
}

contract VerifierBondVaultV2 is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable azl;
    uint256 public immutable minimumBond;
    uint256 public immutable assignmentReserve;
    uint64 public immutable withdrawalCooldown;
    address public immutable treasury;
    address public arbitration;
    mapping(address => uint256) public bonds;
    mapping(address => uint256) public activeAssignments;
    mapping(address => uint256) public reservedSlash;
    mapping(address => uint64) public withdrawReadyAt;
    mapping(address => uint256) public pendingPayouts;
    uint256 public totalBonded;
    uint256 public totalPendingPayouts;

    event ArbitrationConfigured(address indexed arbitration);
    event Bonded(address indexed verifier, uint256 amount);
    event WithdrawalScheduled(address indexed verifier, uint64 readyAt);
    event Withdrawn(address indexed verifier, uint256 amount);
    event AssignmentChanged(address indexed verifier, bool assigned);
    event Slashed(address indexed verifier, address indexed recipient, uint256 amount);

    modifier onlyArbitration() { require(msg.sender == arbitration, "VBv2: arbitration"); _; }

    constructor(address _azl, uint256 _minimumBond, uint64 _withdrawalCooldown, address _treasury, address initialOwner)
        V2Ownable2Step(initialOwner)
    {
        require(
            _azl.code.length != 0 && _minimumBond > 0 && _withdrawalCooldown > 0 && _treasury != address(0),
            "VBv2: config"
        );
        azl = IERC20(_azl);
        minimumBond = _minimumBond;
        assignmentReserve = _minimumBond;
        withdrawalCooldown = _withdrawalCooldown;
        treasury = _treasury;
    }

    /// @dev One-shot bootstrap wiring; misconfiguration before `validateGraph()` is permanent.
    function configureArbitration(address _arbitration) external onlyOwner {
        require(arbitration == address(0) && _arbitration.code.length != 0, "VBv2: configured");
        require(IArbitrationBondLink(_arbitration).bonds() == address(this), "VBv2: reciprocal");
        arbitration = _arbitration;
        emit ArbitrationConfigured(_arbitration);
    }

    function bond(uint256 amount) external nonReentrant {
        require(amount > 0, "VBv2: amount");
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 senderBefore = azl.balanceOf(msg.sender);
        azl.safeTransferFrom(msg.sender, address(this), amount);
        require(azl.balanceOf(address(this)) - beforeBalance == amount
            && senderBefore - azl.balanceOf(msg.sender) == amount, "VBv2: transfer");
        bonds[msg.sender] += amount;
        delete withdrawReadyAt[msg.sender];
        totalBonded += amount;
        emit Bonded(msg.sender, amount);
    }

    /// @dev Panel-exit guard skipped while `arbitration == address(0)` during factory batch deploy.
    function scheduleWithdrawal() external {
        require(activeAssignments[msg.sender] == 0 && bonds[msg.sender] > 0, "VBv2: schedule");
        if (arbitration != address(0)) {
            (bool isPanelMember, bool otherEligible) = _panelExitStatus(msg.sender);
            require(!isPanelMember || otherEligible, "VBv2: final eligible member");
        }
        uint64 readyAt = uint64(block.timestamp) + withdrawalCooldown;
        withdrawReadyAt[msg.sender] = readyAt;
        emit WithdrawalScheduled(msg.sender, readyAt);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(
            activeAssignments[msg.sender] == 0 && withdrawReadyAt[msg.sender] != 0
                && block.timestamp >= withdrawReadyAt[msg.sender] && amount > 0 && amount <= bonds[msg.sender],
            "VBv2: withdraw"
        );
        uint256 remaining = bonds[msg.sender] - amount;
        if (remaining < minimumBond && arbitration != address(0)) {
            (bool isPanelMember, bool otherEligible) = _panelExitStatus(msg.sender);
            require(!isPanelMember || otherEligible, "VBv2: final eligible member");
        }
        bonds[msg.sender] = remaining;
        delete withdrawReadyAt[msg.sender];
        totalBonded -= amount;
        _safeTransferExact(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function isEligible(address verifier) external view returns (bool) {
        return bonds[verifier] >= minimumBond && bonds[verifier] - reservedSlash[verifier] >= assignmentReserve
            && withdrawReadyAt[verifier] == 0;
    }

    function assign(address verifier) external onlyArbitration {
        require(bonds[verifier] >= minimumBond, "VBv2: bond");
        require(bonds[verifier] - reservedSlash[verifier] >= assignmentReserve, "VBv2: capacity");
        require(withdrawReadyAt[verifier] == 0, "VBv2: withdrawing");
        activeAssignments[verifier]++;
        reservedSlash[verifier] += assignmentReserve;
        emit AssignmentChanged(verifier, true);
    }

    function canRelease(address verifier) external view returns (bool) {
        return verifier != address(0) && activeAssignments[verifier] > 0;
    }

    function release(address verifier) external onlyArbitration {
        require(activeAssignments[verifier] > 0, "VBv2: assignment");
        activeAssignments[verifier]--;
        reservedSlash[verifier] -= assignmentReserve;
        emit AssignmentChanged(verifier, false);
    }

    function slashAndRelease(address verifier, uint256 amount) external onlyArbitration nonReentrant {
        require(activeAssignments[verifier] > 0 && amount <= assignmentReserve, "VBv2: assignment");
        require(amount <= bonds[verifier], "VBv2: slash");
        activeAssignments[verifier]--;
        reservedSlash[verifier] -= assignmentReserve;
        if (amount > 0) {
            bonds[verifier] -= amount;
            totalBonded -= amount;
            if (_payOrDefer(treasury, amount)) {
                ITreasuryBondRevenueV2(treasury).recordBondSlashRevenue(amount);
            }
            emit Slashed(verifier, treasury, amount);
        }
        emit AssignmentChanged(verifier, false);
    }

    function claimPayout(address recipient) external nonReentrant {
        uint256 amount = pendingPayouts[msg.sender];
        require(recipient != address(0) && amount > 0, "VBv2: payout");
        if (msg.sender == treasury) require(recipient == treasury, "VBv2: treasury payout");
        pendingPayouts[msg.sender] = 0;
        totalPendingPayouts -= amount;
        _safeTransferExact(recipient, amount);
        if (msg.sender == treasury) ITreasuryBondRevenueV2(treasury).recordBondSlashRevenue(amount);
    }

    function liabilities() public view returns (uint256) { return totalBonded + totalPendingPayouts; }

    function _payOrDefer(address recipient, uint256 amount) private returns (bool paid) {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        (bool ok, bytes memory data) = address(azl).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool validReturn = data.length == 0 || (data.length == 32 && abi.decode(data, (bool)));
        uint256 afterBalance = azl.balanceOf(address(this));
        uint256 recipientAfter = azl.balanceOf(recipient);
        if (!ok || !validReturn || beforeBalance < afterBalance || beforeBalance - afterBalance != amount
            || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount) {
            require(afterBalance == beforeBalance && recipientAfter == recipientBefore, "VBv2: unsafe transfer");
            pendingPayouts[recipient] += amount;
            totalPendingPayouts += amount;
            return false;
        }
        return true;
    }

    function _safeTransferExact(address recipient, uint256 amount) private {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        azl.safeTransfer(recipient, amount);
        require(beforeBalance - azl.balanceOf(address(this)) == amount
            && azl.balanceOf(recipient) - recipientBefore == amount, "VBv2: transfer delta");
    }

    function _panelExitStatus(address member) private view returns (bool isPanelMember, bool otherEligible) {
        (bool ok, bytes memory data) = arbitration.staticcall(
            abi.encodeCall(IArbitrationPanelGuardV2.hasEligiblePanelMemberExcluding, (member))
        );
        if (ok && data.length == 32) {
            otherEligible = abi.decode(data, (bool));
        }
        (bool listedOk, bytes memory listedData) = arbitration.staticcall(
            abi.encodeWithSignature("authorized(address)", member)
        );
        isPanelMember = listedOk && listedData.length == 32 && abi.decode(listedData, (bool));
    }
}
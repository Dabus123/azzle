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

interface IStakingV2 {
    function notifyReward(uint256 amount) external;
    function treasury() external view returns (address);
}

interface IBondSlashPayoutV2 {
    function claimPayout(address recipient) external;
}

contract TreasuryRouterV2 is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant STAKER_SHARE_BPS = 4_000;
    uint16 public constant BURN_SHARE_BPS = 4_000;
    IERC20 public immutable azl;
    address public vault;
    address public staking;
    address public bondVault;
    address public burnRecipient;
    uint256 public recordedRevenue;
    uint256 public distributedRevenue;
    uint256 public reserve;

    event Configured(address indexed vault, address indexed staking);
    event BondVaultConfigured(address indexed bondVault);
    event RevenueRecorded(uint256 amount, uint256 totalRecorded);
    event BondSlashRevenueRecorded(address indexed bondVault, uint256 amount, uint256 totalRecorded);
    event RevenueDistributed(uint256 amount, uint256 stakerAmount, uint256 burnAmount, uint256 reserveAmount);
    event ReserveWithdrawn(address indexed recipient, uint256 amount);

    modifier onlyVault() { require(msg.sender == vault, "Tv2: vault"); _; }
    modifier onlyBondVault() { require(msg.sender == bondVault, "Tv2: bond vault"); _; }

    constructor(address _azl, address _burnRecipient, address initialOwner) V2Ownable2Step(initialOwner) {
        require(_azl.code.length != 0 && _burnRecipient != address(0), "Tv2: config");
        azl = IERC20(_azl);
        burnRecipient = _burnRecipient;
    }

    /// @dev One-shot; vault and staking addresses are immutable after configure.
    function configure(address _vault, address _staking) external onlyOwner {
        require(vault == address(0), "Tv2: configured");
        require(_vault.code.length != 0 && _staking.code.length != 0, "Tv2: config");
        vault = _vault;
        staking = _staking;
        emit Configured(_vault, _staking);
    }

    /// @dev One-shot bond-vault link for slash revenue pull path.
    function configureBondVault(address _bondVault) external onlyOwner {
        require(bondVault == address(0) && _bondVault.code.length != 0, "Tv2: bond vault config");
        bondVault = _bondVault;
        emit BondVaultConfigured(_bondVault);
    }

    /// @notice Pulls deferred bond-slash AZL into this treasury and records revenue on receipt.
    /// @dev Bond vault only. Agent-deposit deferred fees use `AgentDepositVaultV2.claimPayout(treasury)` directly.
    function claimBondSlashPayout() external {
        require(bondVault != address(0), "Tv2: bond vault");
        IBondSlashPayoutV2(bondVault).claimPayout(address(this));
    }

    function validateGraph() external view returns (bool) {
        require(vault != address(0) && staking != address(0), "Tv2: graph");
        require(IStakingV2(staking).treasury() == address(this), "Tv2: staking link");
        return true;
    }

    function recordRevenue(uint256 amount) external onlyVault nonReentrant {
        _recordRevenue(amount);
    }

    function recordBondSlashRevenue(uint256 amount) external onlyBondVault nonReentrant {
        _recordRevenue(amount);
        emit BondSlashRevenueRecorded(msg.sender, amount, recordedRevenue);
    }

    function _recordRevenue(uint256 amount) private {
        require(amount > 0, "Tv2: amount");
        uint256 unrecorded = azl.balanceOf(address(this)) + distributedRevenue - recordedRevenue - reserve;
        require(unrecorded >= amount, "Tv2: unfunded revenue");
        recordedRevenue += amount;
        emit RevenueRecorded(amount, recordedRevenue);
    }

    function distributableRevenue() public view returns (uint256) {
        return recordedRevenue - distributedRevenue;
    }

    /// @dev Accepted Risk (deliberate trade-off): no minimum-amount guard. Sub-threshold amount values
    ///      can cause stakerAmount/rewardRate to floor to zero and revert notifyReward, leaving that
    ///      revenue undistributable until bundled with a later, larger call. Treated as an operational/UX
    ///      concern for the owner-only caller, not a security issue.
    function distribute(uint256 amount) external nonReentrant {
        require(msg.sender == owner(), "Tv2: distribute caller");
        require(staking != address(0) && amount > 0 && amount <= distributableRevenue(), "Tv2: distribute");
        require(azl.balanceOf(address(this)) >= reserve + amount, "Tv2: funds");
        distributedRevenue += amount;
        uint256 stakerAmount = (amount * STAKER_SHARE_BPS) / 10_000;
        uint256 burnAmount = (amount * BURN_SHARE_BPS) / 10_000;
        uint256 reserveAmount = amount - stakerAmount - burnAmount;
        reserve += reserveAmount;
        azl.forceApprove(staking, stakerAmount);
        /// @dev Accepted Risk (deliberate trade-off): unlike the burn leg below, the staker-leg pull has
        ///      no balance-delta verification. This assumes staking.notifyReward() fully consumes its
        ///      approved allowance in one synchronous call, matching the actual deployed UnionStakingVaultV2
        ///      implementation. Revisit if staking is ever repointed to a contract with different pull semantics.
        IStakingV2(staking).notifyReward(stakerAmount);
        azl.forceApprove(staking, 0);
        _safeTransferExact(burnRecipient, burnAmount);
        emit RevenueDistributed(amount, stakerAmount, burnAmount, reserveAmount);
    }

    function withdrawReserve(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0) && amount > 0 && amount <= reserve, "Tv2: reserve");
        reserve -= amount;
        _safeTransferExact(recipient, amount);
        emit ReserveWithdrawn(recipient, amount);
    }

    /// @dev Standard AZL only — fee-on-transfer or rebasing tokens break revenue accounting.
    function _safeTransferExact(address recipient, uint256 amount) internal {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        azl.safeTransfer(recipient, amount);
        require(beforeBalance - azl.balanceOf(address(this)) == amount
            && azl.balanceOf(recipient) - recipientBefore == amount, "Tv2: transfer delta");
    }
}

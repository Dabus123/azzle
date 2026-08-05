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
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {V2Ownable2Step} from "./access/V2Ownable2Step.sol";

interface ITreasuryStakingLinkV2 {
    function staking() external view returns (address);
}

contract UnionStakingVaultV2 is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant ACC = 1e27;
    uint256 public constant CREDIT_UNIT = 1e18;
    uint256 public constant CREDIT_CAP = 600_000 * CREDIT_UNIT;
    uint256 public constant CREDIT_BASE_STAKE = 100_000_000 * 1e18;
    uint256 public constant CREDIT_PERIOD = 30 days;
    uint256 private constant CREDIT_ACC = 1e18;

    uint256 public immutable rewardDuration;
    IERC20 public immutable azl;
    address public treasury;
    address public registry;
    bool public stakingActive;
    uint256 public totalStaked;
    uint256 public totalRewardLiability;
    uint256 public totalRewardsNotified;
    uint256 public totalRewardsDistributed;
    uint256 public totalRewardsClaimed;
    uint256 public undistributedRewards;
    uint256 public roundingDust;
    uint256 public totalPendingPayouts;
    uint256 public accRewardPerShare;
    uint256 public rewardRate;
    uint256 public rewardFinish;
    uint256 public lastUpdate;
    uint256 public totalCreditsIssued;
    uint256 public totalCreditsSpent;
    uint256 public outstandingTaskCredits;
    bool public creditIssuanceClosed;
    uint256 public accCreditPerToken;
    uint256 public lastCreditAccrual;
    uint256 public creditEmissionRemainder;
    uint256 public creditAccumulatorRemainderScaled;
    mapping(address => uint256) public stakeOf;
    mapping(address => uint256) public rewardDebt;
    mapping(address => uint256) public accrued;
    mapping(address => uint256) public pendingPayouts;
    mapping(address => uint256) public bankedCredits;
    mapping(address => uint256) public creditDebt;
    mapping(address => uint256) public creditRemainderScaled;
    mapping(uint256 => mapping(bool => address)) public taskCreditPayer;

    event TreasuryConfigured(address indexed treasury);
    event RegistryConfigured(address indexed registry);
    event StakingActivated(uint256 indexed timestamp);
    event Staked(address indexed account, uint256 amount);
    event Unstaked(address indexed account, address indexed recipient, uint256 amount);
    event RewardNotified(uint256 amount, uint256 rewardRate, uint256 rewardFinish, uint256 schedulingDust);
    event RewardsDistributed(uint256 emission, uint256 distributed, uint256 undistributed, uint256 roundingDust);
    event RewardClaimed(address indexed account, address indexed recipient, uint256 amount);
    event PayoutDeferred(address indexed account, address indexed recipient, uint256 amount);
    event UndistributedRescued(address indexed recipient, uint256 amount);
    event SurplusRescued(address indexed recipient, uint256 amount);
    event CreditsBanked(address indexed account, uint256 amount, uint256 balance);
    event CreditSpent(address indexed account, uint256 balance);
    event CreditTransferred(address indexed from, address indexed to);
    event CreditCapReached(uint256 totalIssued);

    modifier onlyTreasury() { require(msg.sender == treasury, "Sv2: treasury"); _; }
    modifier onlyRegistry() { require(msg.sender == registry, "Sv2: registry"); _; }

    constructor(address _azl, uint256 _duration, address initialOwner) V2Ownable2Step(initialOwner) {
        require(_azl.code.length != 0 && _duration > 0, "Sv2: config");
        azl = IERC20(_azl);
        rewardDuration = _duration;
        lastUpdate = block.timestamp;
        lastCreditAccrual = block.timestamp;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(treasury == address(0) && _treasury.code.length != 0, "Sv2: treasury");
        treasury = _treasury;
        emit TreasuryConfigured(_treasury);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(registry == address(0) && _registry.code.length != 0, "Sv2: registry");
        registry = _registry;
        emit RegistryConfigured(_registry);
    }

    function activateStaking() external onlyOwner {
        require(!stakingActive, "Sv2: active");
        stakingActive = true;
        lastUpdate = block.timestamp;
        lastCreditAccrual = block.timestamp;
        emit StakingActivated(block.timestamp);
    }

    function validateGraph() external view returns (bool) {
        require(treasury != address(0) && registry != address(0), "Sv2: graph");
        require(ITreasuryStakingLinkV2(treasury).staking() == address(this), "Sv2: treasury link");
        return true;
    }

    /// @dev Accepted Risk (deliberate trade-off): no minimum stake duration or unstake cooldown. A large
    ///      depositor can front-run notifyReward() and capture a share of freshly-scheduled rewards
    ///      disproportionate to their time-weighted contribution, then unstake shortly after. Standard
    ///      tradeoff for this reward-pool design; a cooldown was judged to hurt legitimate stakers'
    ///      liquidity more than it helps against this griefing pattern at current scale.
    function stake(uint256 amount) external nonReentrant {
        require(stakingActive && amount > 0, "Sv2: stake");
        _update(msg.sender);
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 senderBefore = azl.balanceOf(msg.sender);
        azl.safeTransferFrom(msg.sender, address(this), amount);
        require(azl.balanceOf(address(this)) - beforeBalance == amount
            && senderBefore - azl.balanceOf(msg.sender) == amount, "Sv2: transfer");
        stakeOf[msg.sender] += amount;
        totalStaked += amount;
        rewardDebt[msg.sender] = (stakeOf[msg.sender] * accRewardPerShare) / ACC;
        creditDebt[msg.sender] = accCreditPerToken;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount, address recipient) external nonReentrant {
        require(stakingActive && recipient != address(0) && amount > 0 && amount <= stakeOf[msg.sender], "Sv2: unstake");
        _update(msg.sender);
        stakeOf[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = (stakeOf[msg.sender] * accRewardPerShare) / ACC;
        creditDebt[msg.sender] = accCreditPerToken;
        _safeTransferExact(recipient, amount);
        emit Unstaked(msg.sender, recipient, amount);
    }

    function notifyReward(uint256 amount) external onlyTreasury nonReentrant {
        require(stakingActive && amount > 0, "Sv2: reward");
        _update(address(0));
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 senderBefore = azl.balanceOf(msg.sender);
        azl.safeTransferFrom(msg.sender, address(this), amount);
        require(azl.balanceOf(address(this)) - beforeBalance == amount
            && senderBefore - azl.balanceOf(msg.sender) == amount, "Sv2: transfer");

        uint256 remaining = block.timestamp < rewardFinish ? (rewardFinish - block.timestamp) * rewardRate : 0;
        uint256 scheduled = amount + remaining;
        rewardRate = scheduled / rewardDuration;
        require(rewardRate > 0, "Sv2: small reward");
        uint256 schedulingDust = scheduled - rewardRate * rewardDuration;
        if (schedulingDust > 0) {
            undistributedRewards += schedulingDust;
            roundingDust += schedulingDust;
        }
        rewardFinish = block.timestamp + rewardDuration;
        lastUpdate = block.timestamp;
        totalRewardLiability += amount;
        totalRewardsNotified += amount;
        emit RewardNotified(amount, rewardRate, rewardFinish, schedulingDust);
    }

    function checkpoint() external { _update(address(0)); }

    /// @notice Total spendable Action Credits: banked whole credits plus pending accrual.
    function creditsOf(address account) public view returns (uint256) {
        return bankedCredits[account] + _pendingCredits(account);
    }

    function creditsRemaining() external view returns (uint256) {
        (, uint256 issued,,,, bool closes) = _projectCreditAccrual();
        return creditIssuanceClosed || closes ? 0 : CREDIT_CAP - issued;
    }

    function bankCredits() external nonReentrant {
        require(stakingActive, "Sv2: inactive");
        _update(msg.sender);
    }

    function trySpendCredit(address account, uint256 taskId, bool isPost)
        external
        onlyRegistry
        returns (bool spent)
    {
        // Staking is deliberately wired before activation in the production
        // graph.  An inactive vault must behave as an empty credit source so
        // the registry can fall back to the normal deposit access fee.
        if (!stakingActive) return false;
        _update(account);
        uint256 balance = bankedCredits[account];
        if (balance < CREDIT_UNIT) return false;
        if (taskId != 0 && taskCreditPayer[taskId][isPost] != address(0)) return false;
        bankedCredits[account] = balance - CREDIT_UNIT;
        totalCreditsSpent += CREDIT_UNIT;
        if (taskId != 0) {
            taskCreditPayer[taskId][isPost] = account;
            outstandingTaskCredits += CREDIT_UNIT;
        }
        emit CreditSpent(account, bankedCredits[account]);
        return true;
    }

    function canSettleSpentCredit(uint256 taskId, address from, bool isPost) external view returns (bool) {
        return taskId != 0 && from != address(0) && taskCreditPayer[taskId][isPost] == from
            && outstandingTaskCredits >= CREDIT_UNIT;
    }

    /// @notice Finalize an outstanding task reservation. `totalCreditsSpent` is
    ///         cumulative; `outstandingTaskCredits` tracks unsettled task credits.
    /// @dev Registry is trusted to choose `to` (forfeit recipient). Only registry may call.
    function settleSpentCredit(uint256 taskId, address from, address to, bool isPost) external onlyRegistry {
        require(
            taskId != 0 && from != address(0) && taskCreditPayer[taskId][isPost] == from
                && outstandingTaskCredits >= CREDIT_UNIT,
            "Sv2: credit settlement"
        );
        delete taskCreditPayer[taskId][isPost];
        outstandingTaskCredits -= CREDIT_UNIT;
        if (to == address(0)) return;

        // Match the legacy vault's transfer semantics: settle both accounts
        // against the same credit accumulator before moving the whole credit.
        _update(from);
        _update(to);
        bankedCredits[to] += CREDIT_UNIT;
        emit CreditsBanked(to, CREDIT_UNIT, bankedCredits[to]);
        emit CreditTransferred(from, to);
    }

    function claim(address recipient) external nonReentrant {
        require(recipient != address(0), "Sv2: recipient");
        _update(msg.sender);
        uint256 amount = accrued[msg.sender];
        require(amount > 0, "Sv2: claim");
        accrued[msg.sender] = 0;
        _payOrDefer(msg.sender, recipient, amount);
    }

    function claimPayout(address recipient) external nonReentrant {
        require(recipient != address(0), "Sv2: recipient");
        uint256 amount = pendingPayouts[msg.sender];
        require(amount > 0, "Sv2: payout");
        pendingPayouts[msg.sender] = 0;
        totalPendingPayouts -= amount;
        totalRewardLiability -= amount;
        totalRewardsClaimed += amount;
        _safeTransferExact(recipient, amount);
        emit RewardClaimed(msg.sender, recipient, amount);
    }

    function rescueUndistributed(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0) && amount > 0, "Sv2: rescue");
        _update(address(0));
        require(amount <= undistributedRewards, "Sv2: undistributed");
        undistributedRewards -= amount;
        totalRewardLiability -= amount;
        _safeTransferExact(recipient, amount);
        emit UndistributedRescued(recipient, amount);
    }

    function rescueSurplus(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0) && amount > 0, "Sv2: surplus");
        require(azl.balanceOf(address(this)) >= totalStaked + totalRewardLiability + amount, "Sv2: surplus funds");
        _safeTransferExact(recipient, amount);
        emit SurplusRescued(recipient, amount);
    }

    function liabilities() external view returns (uint256) { return totalStaked + totalRewardLiability; }

    function _update(address account) internal {
        _accrueCredits();
        uint256 until = block.timestamp < rewardFinish ? block.timestamp : rewardFinish;
        if (until > lastUpdate) {
            uint256 emission = (until - lastUpdate) * rewardRate;
            uint256 distributed;
            uint256 orphaned;
            uint256 dust;
            if (totalStaked == 0) {
                orphaned = emission;
                undistributedRewards += emission;
            } else if (emission > 0) {
                uint256 increment = (emission * ACC) / totalStaked;
                distributed = (increment * totalStaked) / ACC;
                dust = emission - distributed;
                accRewardPerShare += increment;
                totalRewardsDistributed += distributed;
                if (dust > 0) {
                    undistributedRewards += dust;
                    roundingDust += dust;
                }
            }
            lastUpdate = until;
            emit RewardsDistributed(emission, distributed, orphaned, dust);
        }
        if (account != address(0)) {
            uint256 accumulated = (stakeOf[account] * accRewardPerShare) / ACC;
            accrued[account] += accumulated - rewardDebt[account];
            rewardDebt[account] = accumulated;
            _settleCredits(account);
        }
    }

    function _pendingCredits(address account) internal view returns (uint256) {
        (, , , uint256 projectedAcc,,) = _projectCreditAccrual();
        return
            (stakeOf[account] * (projectedAcc - creditDebt[account]) + creditRemainderScaled[account])
                / CREDIT_ACC;
    }

    /// @dev Legacy-compatible credit settlement/checkpoint split. Keeping the
    ///      remainder on the account preserves fractional credits across
    ///      staking changes and transfers.
    function _settleCredits(address account) internal {
        uint256 staked = stakeOf[account];
        if (staked == 0) {
            creditDebt[account] = accCreditPerToken;
            return;
        }
        uint256 scaled = staked * (accCreditPerToken - creditDebt[account]) + creditRemainderScaled[account];
        uint256 credits = scaled / CREDIT_ACC;
        creditRemainderScaled[account] = scaled % CREDIT_ACC;
        if (credits > 0) {
            bankedCredits[account] += credits;
            emit CreditsBanked(account, credits, bankedCredits[account]);
        }
        creditDebt[account] = accCreditPerToken;
    }

    function _accrueCredits() internal {
        (
            uint256 periodCredits,
            uint256 issued,
            uint256 emissionRemainder,
            uint256 projectedAcc,
            uint256 accumulatorRemainder,
            bool closes
        ) = _projectCreditAccrual();
        if (block.timestamp == lastCreditAccrual) return;
        lastCreditAccrual = block.timestamp;
        creditEmissionRemainder = emissionRemainder;
        if (periodCredits == 0) return;
        totalCreditsIssued = issued;
        accCreditPerToken = projectedAcc;
        creditAccumulatorRemainderScaled = accumulatorRemainder;
        if (closes) {
            creditIssuanceClosed = true;
            emit CreditCapReached(issued);
        }
    }

    function _projectCreditAccrual()
        internal
        view
        returns (
            uint256 periodCredits,
            uint256 issued,
            uint256 emissionRemainder,
            uint256 projectedAcc,
            uint256 accumulatorRemainder,
            bool closes
        )
    {
        issued = totalCreditsIssued;
        emissionRemainder = creditEmissionRemainder;
        projectedAcc = accCreditPerToken;
        accumulatorRemainder = creditAccumulatorRemainderScaled;
        if (!stakingActive || creditIssuanceClosed || totalStaked == 0 || issued >= CREDIT_CAP) {
            closes = creditIssuanceClosed || issued >= CREDIT_CAP;
            return (0, issued, emissionRemainder, projectedAcc, accumulatorRemainder, closes);
        }
        uint256 elapsed = block.timestamp - lastCreditAccrual;
        if (elapsed == 0) return (0, issued, emissionRemainder, projectedAcc, accumulatorRemainder, false);
        uint256 denominator = CREDIT_BASE_STAKE * CREDIT_PERIOD;
        uint256 emitted = FullMath.mulDiv(elapsed * CREDIT_UNIT, totalStaked, denominator);
        emissionRemainder += mulmod(elapsed * CREDIT_UNIT, totalStaked, denominator);
        if (emissionRemainder >= denominator) {
            emitted += emissionRemainder / denominator;
            emissionRemainder %= denominator;
        }
        uint256 remaining = CREDIT_CAP - issued;
        periodCredits = emitted > remaining ? remaining : emitted;
        closes = periodCredits == remaining;
        issued += periodCredits;
        if (periodCredits > 0) {
            uint256 accumulator = periodCredits * CREDIT_ACC + accumulatorRemainder;
            /// @dev Accepted Risk (deliberate trade-off): the terminal credit-cap chunk is split by
            ///      instantaneous totalStaked at the moment issuance closes, not a time-weighted average.
            ///      A last-block staker can capture a disproportionate share of the final chunk. Adding a
            ///      minimum holding duration or stake-seconds accumulator was judged not worth the added
            ///      complexity given this only affects the single, one-time moment the lifetime CREDIT_CAP
            ///      is exhausted — not ongoing reward distribution.
            projectedAcc += accumulator / totalStaked;
            accumulatorRemainder = accumulator % totalStaked;
        }
        if (closes) emissionRemainder = 0;
    }

    function _payOrDefer(address account, address recipient, uint256 amount) internal {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        (bool ok, bytes memory data) = address(azl).call(abi.encodeCall(IERC20.transfer, (recipient, amount)));
        bool validReturn = data.length == 0 || (data.length == 32 && abi.decode(data, (bool)));
        uint256 afterBalance = azl.balanceOf(address(this));
        uint256 recipientAfter = azl.balanceOf(recipient);
        if (!ok || !validReturn || beforeBalance < afterBalance || beforeBalance - afterBalance != amount
            || recipientAfter < recipientBefore || recipientAfter - recipientBefore != amount) {
            require(afterBalance == beforeBalance && recipientAfter == recipientBefore, "Sv2: unsafe transfer");
            pendingPayouts[account] += amount;
            totalPendingPayouts += amount;
            emit PayoutDeferred(account, recipient, amount);
            return;
        }
        totalRewardLiability -= amount;
        totalRewardsClaimed += amount;
        emit RewardClaimed(account, recipient, amount);
    }

    function _safeTransferExact(address recipient, uint256 amount) internal {
        uint256 beforeBalance = azl.balanceOf(address(this));
        uint256 recipientBefore = azl.balanceOf(recipient);
        azl.safeTransfer(recipient, amount);
        require(beforeBalance - azl.balanceOf(address(this)) == amount
            && azl.balanceOf(recipient) - recipientBefore == amount, "Sv2: transfer delta");
    }
}

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

import {V2Ownable2Step} from "./access/V2Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IAzlUsdOracle} from "./interfaces/IAzlUsdOracle.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

interface IAgentDepositV2 {
    function reserveTask(uint256 taskId, address account, bool waiveAccessFee, bool createQuote)
        external
        returns (uint256);
    function releaseTask(uint256 taskId, address account) external;
    function debitAccessFeeTo(uint256 taskId, address account, address recipient) external returns (uint256);
    function debitExitFee(uint256 taskId, address account, address harmed) external;
    function canResolveTask(
        uint256 taskId,
        address poster,
        address worker,
        address defaulter,
        address harmed
    ) external view returns (bool);
}

interface IEscrowV2 {
    function create(uint256 taskId, address poster, address worker) external;
    function fund(uint256 taskId, uint256 amount) external;
    function release(uint256 taskId, uint256 amount) external;
    function close(uint256 taskId) external;
    function refund(uint256 taskId) external;
}

interface IArbitrationV2 {
    function openDispute(uint256 taskId, address opener, bytes32 evidenceHash) external;
}

interface IReputationV2 {
    function recordCompletion(uint256 taskId, address poster, address worker) external;
    function recordPosterExpiry(uint256 taskId, address poster, address worker) external;
}

interface IActionCreditStakingV2 {
    function trySpendCredit(address account, uint256 taskId, bool isPost) external returns (bool);
    function canSettleSpentCredit(uint256 taskId, address from, bool isPost) external view returns (bool);
    function settleSpentCredit(uint256 taskId, address from, address to, bool isPost) external;
}

/// @notice AZL-denominated task state machine. Every payment amount is fixed AZL wei.
/// @dev Terminal paths (escrow / deposit penalties / reputation / credits):
///      - `complete` / `release`→full: escrow→worker; no penalties; credits returned.
///      - `cancel`: unfunded pre-active; optional worker access-fee transfer when poster cancels after claim.
///      - `expire`: permissionless default; escrow always refunds poster; posterDefaulted uses
///        deposit-side penalties only (`debitAccessFeeTo`, reputation, credit forfeiture).
///      - `openDispute`→`rule`: adjudicated; `ArbitrationModuleV2` calls `escrow.settle` then this
///        registry's `resolveDispute` (exit fees, reputation via arbitration module).
///      - `openDispute`→`timeout`: non-adjudicated liveness fallback; escrow→poster; no `expire`
///        poster-default deposit bundle; MUTUAL resolution via arbitration callback; poster gets
///        a light unresolved-dispute reputation signal (not a ruling against the poster).
///      Escrow is never moved inside `resolveDispute`; frozen escrow is settled by arbitration first.
contract TaskRegistryV2 is V2Ownable2Step, ReentrancyGuard {
    enum State { NONE, POSTED, CLAIMED, ACTIVE, DISPUTED, COMPLETED, CANCELLED, RESOLVED }
    enum Resolution { NONE, POSTER_WINS, WORKER_WINS, SPLIT, MUTUAL }

    struct Task {
        address poster;
        address worker;
        uint256 totalAmount;
        uint256 funded;
        uint256 released;
        uint64 deadline;
        uint64 fundingDeadline;
        uint64 deliveredAt;
        State state;
    }

    /// @dev Reserved for off-chain XMTP settlement digests; not read onchain in this registry.
    bytes32 public constant SETTLEMENT_DOMAIN = keccak256("azzle-task-settlement-v3-azl");
    uint64 public constant MAX_TASK_DURATION = 30 days;
    uint64 public constant FUNDING_WINDOW = 1 days;
    uint64 public constant DELIVERY_GRACE_WINDOW = 1 days;
    /// @dev Poster-initiated disputes after timely delivery must open while
    ///      `block.timestamp <= deliveredAt + POSTER_DISPUTE_GRACE_WINDOW`. Shorter than
    ///      `DELIVERY_GRACE_WINDOW` so a poster cannot dispute-and-stall past the window where
    ///      `expire()` applies default penalties. Accepted trade-off: from T+12h through T+24h
    ///      after delivery the poster has no onchain action (`openDispute` blocked, `expire` still
    ///      gated on the full grace window) — inert, since no party can extract value in that gap.
    ///      `DELIVERY_GRACE_WINDOW` (= 86400 s, even) / 2 yields an exact 43200 s midpoint.
    uint64 public constant POSTER_DISPUTE_GRACE_WINDOW = DELIVERY_GRACE_WINDOW / 2;
    IAgentDepositV2 public immutable deposits;
    IEscrowV2 public immutable escrow;
    IAzlUsdOracle public immutable usdOracle;
    IArbitrationV2 public arbitration;
    IReputationV2 public immutable reputation;
    IActionCreditStakingV2 public staking;
    /// @dev Wired for `validateGraph()` only; open/private scope text lives in `TaskScopeRegistryV2`.
    address public scopeRegistry;
    uint256 public immutable openTaskCapUsd6;
    uint256 public openTaskTotalUsd6;
    uint256 public taskCount;
    mapping(address => uint256) public posterOpenTaskTotalUsd6;
    /// @dev Per-poster open-task exposure cap: 20% of global `openTaskCapUsd6`.
    ///      Accepted Risk (deliberate trade-off): any nonzero per-poster cap below 100% still permits
    ///      a well-capitalized sybil (two self-controlled addresses acting as poster + claiming worker)
    ///      to temporarily occupy a fraction of global open-task capacity and block other large tasks
    ///      until resolution. 20% was chosen as a balance between allowing legitimate large single-poster
    ///      volume and limiting monopolization blast radius; the griefing capital is fully recoverable
    ///      by the attacker via `complete()`, making this a temporary availability cost, not a fund-loss
    ///      vector.
    uint256 public constant POSTER_OPEN_TASK_CAP_BPS = 2_000;
    mapping(uint256 => Task) public tasks;
    mapping(uint256 => uint256) public taskDeclaredUsd6;
    mapping(uint256 => uint256) public taskFundedBasisUsd6;
    mapping(uint256 => uint256) public taskAmountUsd6;
    mapping(uint256 => Resolution) public resolutions;
    mapping(uint256 => bool) public taskPosterCredit;
    mapping(uint256 => bool) public taskWorkerCredit;

    event TaskPosted(uint256 indexed taskId, address indexed poster, uint256 totalAmount, uint256 amountUsd6, uint64 deadline);
    event TaskClaimed(uint256 indexed taskId, address indexed worker);
    event TaskFunded(uint256 indexed taskId, uint256 amount);
    event TaskActivated(uint256 indexed taskId);
    event TaskDelivered(uint256 indexed taskId, uint64 deliveredAt);
    event TaskReleased(uint256 indexed taskId, uint256 amount);
    event TaskCompleted(uint256 indexed taskId);
    event TaskCancelled(uint256 indexed taskId);
    event TaskDisputed(uint256 indexed taskId, address indexed opener, bytes32 evidenceHash);
    event TaskResolved(uint256 indexed taskId, Resolution resolution, address defaultingParty);
    event ActionCreditUsed(uint256 indexed taskId, address indexed account, bool indexed post);

    modifier onlyArbitration() {
        require(msg.sender == address(arbitration), "TRv2: arbitration");
        _;
    }

    constructor(
        address _deposits,
        address _escrow,
        address _reputation,
        address _usdOracle,
        uint256 _openTaskCapUsd6,
        address initialOwner
    ) V2Ownable2Step(initialOwner) {
        require(
            _deposits.code.length != 0 && _escrow.code.length != 0 && _reputation.code.length != 0
                && _usdOracle.code.length != 0 && _openTaskCapUsd6 > 0,
            "TRv2: config"
        );
        deposits = IAgentDepositV2(_deposits);
        escrow = IEscrowV2(_escrow);
        reputation = IReputationV2(_reputation);
        usdOracle = IAzlUsdOracle(_usdOracle);
        openTaskCapUsd6 = _openTaskCapUsd6;
    }

    /// @dev One-shot bootstrap wiring; no post-deploy replacement (anti-rug). Complete before renouncing is moot — renounce is disabled.
    function configureScopeRegistry(address _scopeRegistry) external onlyOwner {
        require(scopeRegistry == address(0) && _scopeRegistry.code.length != 0, "TRv2: scope configured");
        scopeRegistry = _scopeRegistry;
    }

    /// @dev One-shot; owner key loss before configure permanently bricks dispute resolution.
    function configureArbitration(address _arbitration) external onlyOwner {
        require(address(arbitration) == address(0) && _arbitration.code.length != 0, "TRv2: configured");
        arbitration = IArbitrationV2(_arbitration);
    }

    /// @dev One-shot; Action Credits unavailable until configured and staking activated.
    function configureStaking(address _staking) external onlyOwner {
        require(address(staking) == address(0) && _staking.code.length != 0, "TRv2: staking");
        staking = IActionCreditStakingV2(_staking);
    }

    /// @dev Latches `taskDeclaredUsd6` at post-time oracle quote. Later `fund()` re-quotes for cap
    ///      increments; gap of up to `MAX_TASK_DURATION` between post and full fund is accepted exposure.
    function post(uint256 totalAmount, uint64 deadline) external nonReentrant returns (uint256 taskId) {
        require(totalAmount > 0 && deadline > block.timestamp && deadline <= block.timestamp + MAX_TASK_DURATION, "TRv2: post");
        // The cap is a hard bound on the task's par-value AZL obligation.
        // Do not apply the conservative access-fee haircut here: doing so
        // would allow aggregate posted obligations to exceed openTaskCapUsd6.
        uint256 amountUsd6 = usdOracle.quoteUsdForAzlPar(totalAmount);
        require(amountUsd6 > 0 && amountUsd6 <= openTaskCapUsd6, "TRv2: cap");

        taskId = ++taskCount;
        tasks[taskId] = Task(msg.sender, address(0), totalAmount, 0, 0, deadline, 0, 0, State.POSTED);
        taskDeclaredUsd6[taskId] = amountUsd6;

        bool waived = _useActionCredit(msg.sender, taskId, true);
        deposits.reserveTask(taskId, msg.sender, waived, true);
        emit TaskPosted(taskId, msg.sender, totalAmount, amountUsd6, deadline);
    }

    /// @dev No live oracle re-check at claim; USD exposure was latched at `post()`. Worker pays real
    ///      access fee here (or Action Credit). Poster `cancel()` with `funded==0` does not auto-refund
    ///      that fee unless poster forfeits their own credit to the worker.
    function claim(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(t.state == State.POSTED && msg.sender != t.poster && block.timestamp <= t.deadline, "TRv2: claim");
        bool waived = _useActionCredit(msg.sender, taskId, false);
        deposits.reserveTask(taskId, msg.sender, waived, false);
        t.worker = msg.sender;
        t.fundingDeadline = uint64(block.timestamp) + FUNDING_WINDOW;
        t.state = State.CLAIMED;
        escrow.create(taskId, t.poster, msg.sender);
        emit TaskClaimed(taskId, msg.sender);
    }

    /// @dev Oracle/cap checks precede effects; effects then precede escrow's token interaction.
    ///      A revert at any point rolls all accounting back atomically.
    ///      When `taskFundedBasisUsd6` already equals par, `fundedUsd6` may be zero while AZL still
    ///      enters escrow — caps track admitted USD6 basis, not continuous mark-to-market.
    function fund(uint256 taskId, uint256 amount) external nonReentrant {
        Task storage t = tasks[taskId];
        require(
            msg.sender == t.poster && (t.state == State.CLAIMED || t.state == State.ACTIVE) && amount > 0
                && t.funded + amount <= t.totalAmount && block.timestamp <= t.deadline
                && (t.state == State.ACTIVE || block.timestamp <= t.fundingDeadline),
            "TRv2: fund"
        );
        uint256 newFunded = t.funded + amount;
        uint256 declaredUsd6 = taskDeclaredUsd6[taskId];
        uint256 postBasisUsd6 = newFunded == t.totalAmount
            ? declaredUsd6
            : FullMath.mulDivRoundingUp(declaredUsd6, newFunded, t.totalAmount);
        // Revalue the cumulative funded amount at admission time. The basis can
        // only increase: price decreases cannot erase exposure already admitted.
        uint256 liveBasisUsd6 = usdOracle.quoteUsdForAzlPar(newFunded);
        uint256 oldFundedUsd6 = taskFundedBasisUsd6[taskId];
        uint256 newFundedUsd6 = postBasisUsd6 > liveBasisUsd6 ? postBasisUsd6 : liveBasisUsd6;
        if (newFundedUsd6 < oldFundedUsd6) newFundedUsd6 = oldFundedUsd6;
        uint256 fundedUsd6 = newFundedUsd6 - oldFundedUsd6;
        require(fundedUsd6 <= openTaskCapUsd6 - openTaskTotalUsd6, "TRv2: cap");
        uint256 posterCap = (openTaskCapUsd6 * POSTER_OPEN_TASK_CAP_BPS) / 10_000;
        require(posterOpenTaskTotalUsd6[t.poster] + fundedUsd6 <= posterCap, "TRv2: poster cap");
        t.funded = newFunded;
        taskFundedBasisUsd6[taskId] = newFundedUsd6;
        taskAmountUsd6[taskId] = newFundedUsd6;
        openTaskTotalUsd6 += fundedUsd6;
        posterOpenTaskTotalUsd6[t.poster] += fundedUsd6;
        escrow.fund(taskId, amount);
        emit TaskFunded(taskId, amount);
        if (newFunded == t.totalAmount && t.state == State.CLAIMED) {
            t.state = State.ACTIVE;
            emit TaskActivated(taskId);
        }
    }

    /// @notice Compatibility no-op for clients that still activate after final funding.
    function activate(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.poster && t.state == State.ACTIVE && t.funded == t.totalAmount, "TRv2: activate");
    }

    /// @notice Records the worker's explicit delivery assertion.
    /// @dev Delivery is an off-chain fact; this timestamp only identifies which
    ///      default path may be penalized after the grace window. Does not move escrow.
    ///      On `expire()` with posterDefaulted, penalties are deposit-side (`debitAccessFeeTo`,
    ///      reputation, poster credit→worker), not escrow auto-release. Dispute before expire for adjudicated escrow.
    function markDelivered(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(
            msg.sender == t.worker && t.state == State.ACTIVE && t.deliveredAt == 0
                && t.funded == t.totalAmount && t.released < t.funded
                && block.timestamp <= t.deadline,
            "TRv2: delivered"
        );
        t.deliveredAt = uint64(block.timestamp);
        emit TaskDelivered(taskId, t.deliveredAt);
    }

    /// @dev Auto-completes when cumulative release reaches full funding (no separate `complete` required).
    function release(uint256 taskId, uint256 amount) external nonReentrant {
        Task storage t = tasks[taskId];
        require(
            msg.sender == t.poster && t.state == State.ACTIVE && amount > 0 && t.released + amount <= t.funded,
            "TRv2: release"
        );
        t.released += amount;
        escrow.release(taskId, amount);
        _reconcileOpenTaskAmount(taskId);
        emit TaskReleased(taskId, amount);
        if (t.released == t.funded && t.funded == t.totalAmount) _finalizeCompletion(taskId, t);
    }

    function complete(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(msg.sender == t.poster && t.state == State.ACTIVE && t.funded == t.totalAmount, "TRv2: complete");
        uint256 remaining = t.funded - t.released;
        t.released = t.funded;
        if (remaining > 0) escrow.release(taskId, remaining);
        _finalizeCompletion(taskId, t);
    }

    /// @dev Poster-only while unfunded. When a worker had claimed, may transfer poster access fee
    ///      to worker unless poster used Action Credit (forfeiture path in `_settleCredits`).
    function cancel(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        require(
            msg.sender == t.poster && (t.state == State.POSTED || t.state == State.CLAIMED) && t.funded == 0,
            "TRv2: cancel"
        );
        t.state = State.CANCELLED;
        _releaseOpenTaskAmount(taskId);
        if (t.worker != address(0)) {
            escrow.close(taskId);
            if (!taskWorkerCredit[taskId]) deposits.debitAccessFeeTo(taskId, t.poster, t.worker);
            deposits.releaseTask(taskId, t.worker);
        }
        deposits.releaseTask(taskId, t.poster);
        _settleCredits(
            taskId,
            t.poster,
            t.worker == address(0) ? t.poster : t.worker,
            t.worker == address(0) ? address(0) : t.worker
        );
        emit TaskCancelled(taskId);
    }

    /// @notice Permissionless terminal fallback after deadline or funding window.
    /// @dev Escrow always refunds to the poster here, even when posterDefaulted. Delivery is
    ///      self-asserted and unverified onchain — auto-releasing escrow on markDelivered would let
    ///      a non-delivering worker extract full task value. Poster default penalties are bounded
    ///      and deposit-side: `debitAccessFeeTo`, `recordPosterExpiry`, poster credit→worker.
    ///      Worker credit is returned on ACTIVE expiry. Underfund path may compensate worker from
    ///      poster deposit when fund was blocked (e.g. oracle downtime). For adjudicated escrow,
    ///      parties must `openDispute()` before expire; dispute timeout also refunds escrow to poster
    ///      but does not apply this poster-default deposit bundle.
    function expire(uint256 taskId) external nonReentrant {
        Task storage t = tasks[taskId];
        bool underfunded = t.state == State.CLAIMED && t.funded < t.totalAmount;
        bool fundingExpired = underfunded && block.timestamp > t.fundingDeadline;
        require((block.timestamp > t.deadline || fundingExpired) && t.state != State.COMPLETED
            && t.state != State.CANCELLED && t.state != State.RESOLVED && t.state != State.DISPUTED,
            "TRv2: expire");
        uint256 remaining = t.funded - t.released;
        bool timelyDelivery = _wasTimelyDelivered(t);
        bool posterDefaulted = remaining > 0 && timelyDelivery
            && block.timestamp > uint256(t.deliveredAt) + DELIVERY_GRACE_WINDOW;
        require(
            !timelyDelivery || posterDefaulted || remaining == 0,
            "TRv2: delivery grace"
        );
        bool wasActive = t.state == State.ACTIVE;
        t.state = State.CANCELLED;
        _releaseOpenTaskAmount(taskId);
        if (remaining > 0) escrow.refund(taskId);
        else if (t.worker != address(0)) escrow.close(taskId);
        if (posterDefaulted) {
            deposits.debitAccessFeeTo(taskId, t.poster, t.worker);
            reputation.recordPosterExpiry(taskId, t.poster, t.worker);
            _settleCredits(taskId, t.poster, t.worker, t.worker);
        } else if (underfunded && t.worker != address(0)) {
            if (!taskWorkerCredit[taskId]) deposits.debitAccessFeeTo(taskId, t.poster, t.worker);
            _settleCredits(taskId, t.poster, t.worker, t.worker);
        } else {
            _settleCredits(
                taskId,
                t.poster,
                t.poster,
                wasActive ? t.worker : address(0)
            );
        }
        deposits.releaseTask(taskId, t.poster);
        if (t.worker != address(0)) deposits.releaseTask(taskId, t.worker);
        emit TaskCancelled(taskId);
    }

    /// @dev Adjudicated terminal path. Escrow frozen here; `ArbitrationModuleV2` settles escrow then
    ///      calls `resolveDispute`. Does not apply `expire()` poster-default penalties — neutral
    ///      outcomes skip `debitExitFee` and reputation defaulting. Opening before expire blocks
    ///      the permissionless default path. Poster cutoff uses `POSTER_DISPUTE_GRACE_WINDOW`
    ///      (half of `DELIVERY_GRACE_WINDOW`) so dispute-and-stall cannot outrun the default path.
    function openDispute(uint256 taskId, bytes32 evidenceHash) external nonReentrant {
        Task storage t = tasks[taskId];
        require(address(arbitration) != address(0), "TRv2: arbitration");
        require(t.state == State.ACTIVE, "TRv2: dispute state");
        require(msg.sender == t.poster || msg.sender == t.worker, "TRv2: party");
        require(
            msg.sender != t.poster || !_wasTimelyDelivered(t)
                || block.timestamp <= uint256(t.deliveredAt) + POSTER_DISPUTE_GRACE_WINDOW,
            "TRv2: poster default"
        );
        require(t.funded == t.totalAmount && t.funded > t.released && evidenceHash != bytes32(0),
            "TRv2: evidence");
        t.state = State.DISPUTED;
        arbitration.openDispute(taskId, msg.sender, evidenceHash);
        emit TaskDisputed(taskId, msg.sender, evidenceHash);
    }

    /// @dev `taskAmountUsd6[taskId] == 0` guards resolution when open-cap accounting was already released.
    function canResolveDispute(uint256 taskId, uint8 outcome) external view returns (bool) {
        Task storage t = tasks[taskId];
        if (t.state != State.DISPUTED || outcome < 1 || outcome > 4 || taskAmountUsd6[taskId] == 0) return false;
        Resolution resolution = Resolution(outcome);
        address defaulter;
        address harmed;
        if (resolution == Resolution.POSTER_WINS) {
            defaulter = t.worker;
            harmed = t.poster;
        } else if (resolution == Resolution.WORKER_WINS) {
            defaulter = t.poster;
            harmed = t.worker;
        }
        if (!deposits.canResolveTask(taskId, t.poster, t.worker, defaulter, harmed)) return false;
        return t.funded == t.totalAmount
            && (!taskPosterCredit[taskId] || staking.canSettleSpentCredit(taskId, t.poster, true))
            && (!taskWorkerCredit[taskId] || staking.canSettleSpentCredit(taskId, t.worker, false));
    }

    /// @notice Final arbitration callback after escrow settlement; proven-default charge uses task-latched values.
    /// @dev Called by `ArbitrationModuleV2` only after `escrow.settle`. Does not touch escrow.
    ///      SPLIT/MUTUAL: no `debitExitFee`; poster credit may route to worker (same as WORKER_WINS).
    ///      Worker spent credit always settles to `address(0)` (returned to staker pool). Intentionally
    ///      asymmetric vs `expire()` poster-default bundle — dispute path is adjudicated, not permissionless default.
    function resolveDispute(uint256 taskId, uint8 outcome) external onlyArbitration nonReentrant {
        Task storage t = tasks[taskId];
        require(t.state == State.DISPUTED && t.funded == t.totalAmount && outcome >= 1 && outcome <= 4,
            "TRv2: resolution");
        Resolution resolution = Resolution(outcome);
        address defaulter;
        address harmed;
        if (resolution == Resolution.POSTER_WINS) {
            defaulter = t.worker;
            harmed = t.poster;
        } else if (resolution == Resolution.WORKER_WINS) {
            defaulter = t.poster;
            harmed = t.worker;
        }
        require(
            deposits.canResolveTask(taskId, t.poster, t.worker, defaulter, harmed)
                && (!taskPosterCredit[taskId] || staking.canSettleSpentCredit(taskId, t.poster, true))
                && (!taskWorkerCredit[taskId] || staking.canSettleSpentCredit(taskId, t.worker, false)),
            "TRv2: settlement preflight"
        );
        resolutions[taskId] = resolution;
        t.state = State.RESOLVED;
        _releaseOpenTaskAmount(taskId);

        if (defaulter != address(0)) deposits.debitExitFee(taskId, defaulter, harmed);
        deposits.releaseTask(taskId, t.poster);
        deposits.releaseTask(taskId, t.worker);
        _settleCredits(
            taskId,
            t.poster,
            resolution == Resolution.WORKER_WINS ? t.worker : address(0),
            address(0)
        );
        emit TaskResolved(taskId, resolution, defaulter);
    }

    function taskParties(uint256 taskId) external view returns (address poster, address worker) {
        Task storage t = tasks[taskId];
        return (t.poster, t.worker);
    }

    function taskState(uint256 taskId) external view returns (State) {
        return tasks[taskId].state;
    }

    function taskTimelyDelivered(uint256 taskId) external view returns (bool) {
        return _wasTimelyDelivered(tasks[taskId]);
    }

    function graph() external view returns (address, address, address, address) {
        return (address(deposits), address(escrow), address(arbitration), address(reputation));
    }

    function validateGraph() external view returns (bool) {
        return address(deposits).code.length != 0 && address(escrow).code.length != 0
            && address(arbitration).code.length != 0 && address(reputation).code.length != 0
            && address(usdOracle).code.length != 0 && scopeRegistry.code.length != 0
            && address(staking).code.length != 0;
    }

    function _useActionCredit(address account, uint256 taskId, bool isPost) internal returns (bool) {
        if (address(staking) != address(0) && staking.trySpendCredit(account, taskId, isPost)) {
            if (isPost) taskPosterCredit[taskId] = true;
            else taskWorkerCredit[taskId] = true;
            emit ActionCreditUsed(taskId, account, isPost);
            return true;
        }
        return false;
    }

    /// @dev Poster credit routes to `posterRecipient` (forfeit/compensation). Worker credit routes to
    ///      `workerRecipient`; `address(0)` returns credit to the staking pool. Worker credit preflight
    ///      (`canSettleSpentCredit`) is enforced on dispute resolution but not on all terminal paths.
    function _settleCredits(
        uint256 taskId,
        address poster,
        address posterRecipient,
        address workerRecipient
    ) internal {
        if (taskPosterCredit[taskId]) {
            delete taskPosterCredit[taskId];
            staking.settleSpentCredit(taskId, poster, posterRecipient, true);
        }
        if (taskWorkerCredit[taskId]) {
            delete taskWorkerCredit[taskId];
            staking.settleSpentCredit(taskId, tasks[taskId].worker, workerRecipient, false);
        }
    }

    function _finalizeCompletion(uint256 taskId, Task storage t) internal {
        t.state = State.COMPLETED;
        _releaseOpenTaskAmount(taskId);
        escrow.close(taskId);
        deposits.releaseTask(taskId, t.poster);
        deposits.releaseTask(taskId, t.worker);
        _settleCredits(taskId, t.poster, address(0), address(0));
        reputation.recordCompletion(taskId, t.poster, t.worker);
        emit TaskCompleted(taskId);
    }

    function _wasTimelyDelivered(Task storage t) internal view returns (bool) {
        return t.deliveredAt != 0 && t.deliveredAt <= t.deadline;
    }

    function _reconcileOpenTaskAmount(uint256 taskId) internal {
        Task storage t = tasks[taskId];
        uint256 remaining = t.funded - t.released;
        uint256 newAmountUsd6 = remaining == 0
            ? 0
            : FullMath.mulDivRoundingUp(taskFundedBasisUsd6[taskId], remaining, t.funded);
        uint256 oldAmountUsd6 = taskAmountUsd6[taskId];
        if (newAmountUsd6 >= oldAmountUsd6) return;
        uint256 reduction = oldAmountUsd6 - newAmountUsd6;
        taskAmountUsd6[taskId] = newAmountUsd6;
        openTaskTotalUsd6 -= reduction;
        posterOpenTaskTotalUsd6[t.poster] -= reduction;
    }

    function _releaseOpenTaskAmount(uint256 taskId) internal {
        uint256 amountUsd6 = taskAmountUsd6[taskId];
        if (amountUsd6 == 0) return;
        delete taskAmountUsd6[taskId];
        openTaskTotalUsd6 -= amountUsd6;
        address poster = tasks[taskId].poster;
        posterOpenTaskTotalUsd6[poster] -= amountUsd6;
    }
}

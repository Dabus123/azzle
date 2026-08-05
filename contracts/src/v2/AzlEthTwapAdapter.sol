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

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";
import {V2Ownable2Step} from "./access/V2Ownable2Step.sol";

interface IAzlV4ObservationSource {
    function consult() external view returns (int24 arithmeticMeanTick);
    function poolManager() external view returns (IV4PoolManager);
    function poolId() external view returns (bytes32);
}

/// @notice Delayed-checkpoint adapter from the immutable AZL/WETH V4 TWAP to AZL per ETH.
/// @dev A governance-proposed reference must survive a delay and agree with a fresh TWAP before
///      activation. Quotes fail closed unless spot, TWAP, delayed reference, and active liquidity agree.
contract AzlEthTwapAdapter is V2Ownable2Step {
    error NotReady();
    error InvalidProposal();

    uint256 public constant WAD = 1e18;
    int256 public constant MAX_SPOT_TWAP_TICK_DEVIATION = 953;
    // floor(ln(1.05) / ln(1.0001)): the largest tick delta strictly within 5%.
    int256 public constant MAX_REFERENCE_TICK_DEVIATION = 487;
    uint64 public constant REFERENCE_DELAY = 24 hours;
    uint64 public constant REFERENCE_MAX_AGE = 7 days;
    uint64 public constant PROPOSAL_EXPIRY = 3 days;
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    uint256 private constant LIQUIDITY_OFFSET = 3;

    IAzlV4ObservationSource public immutable observationOracle;
    IV4PoolManager public immutable poolManager;
    bytes32 public immutable poolId;
    uint128 public immutable minimumActiveLiquidity;

    int24 public referenceTick;
    uint64 public referenceActivatedAt;
    int24 public pendingReferenceTick;
    uint64 public pendingReferenceValidAfter;

    event ReferenceProposed(int24 indexed tick, uint64 validAfter);
    event ReferenceActivated(int24 indexed tick, uint64 activatedAt);
    event ReferenceProposalCancelled();

    constructor(address _observationOracle, uint128 _minimumActiveLiquidity, address initialOwner)
        V2Ownable2Step(initialOwner)
    {
        require(_observationOracle.code.length != 0, "AzlTwap: observer");
        require(_minimumActiveLiquidity != 0, "AzlTwap: liquidity");
        IAzlV4ObservationSource observer = IAzlV4ObservationSource(_observationOracle);
        IV4PoolManager manager = observer.poolManager();
        bytes32 id = observer.poolId();
        require(address(manager).code.length != 0 && id != bytes32(0), "AzlTwap: config");
        observationOracle = observer;
        poolManager = manager;
        poolId = id;
        minimumActiveLiquidity = _minimumActiveLiquidity;
    }

    /// @notice Stages the current mature TWAP for delayed activation by governance.
    /// @dev Reads the observation oracle's TWAP (see AzlV4ObservationOracle.record()).
    // Accepted Risk (deliberate trade-off): AZL is priced off an on-chain AZL/WETH pool
    // rather than directly off USDC, specifically to keep core valuation out of a
    // centralized, blocklistable asset's critical path. The cost of that choice is this
    // checkpoint-based TWAP's manipulation surface — a checkpoint recorded infrequently
    // could weight a single block's price over an outsized share of the window.
    // _validateLivePool's spot-vs-TWAP deviation gate bounds the practical impact, but the
    // operator must still sanity-check the proposed tick against an independent source
    // before calling this. We accept this complexity over USDC-denominated pricing.
    function proposeReference() external onlyOwner {
        int24 meanTick = observationOracle.consult();
        _validateLivePool(meanTick);
        pendingReferenceTick = meanTick;
        pendingReferenceValidAfter = uint64(block.timestamp) + REFERENCE_DELAY;
        emit ReferenceProposed(meanTick, pendingReferenceValidAfter);
    }

    /// @notice Activates a staged reference only if a fresh TWAP still agrees after the delay.
    function activateReference() external onlyOwner {
        uint64 validAfter = pendingReferenceValidAfter;
        if (
            validAfter == 0 || block.timestamp < validAfter
                || block.timestamp > uint256(validAfter) + PROPOSAL_EXPIRY
        ) revert InvalidProposal();
        int24 proposedTick = pendingReferenceTick;
        int24 meanTick = observationOracle.consult();
        _validateLivePool(meanTick);
        if (_absoluteTickDelta(meanTick, proposedTick) > MAX_REFERENCE_TICK_DEVIATION) revert NotReady();

        referenceTick = proposedTick;
        referenceActivatedAt = uint64(block.timestamp);
        delete pendingReferenceTick;
        delete pendingReferenceValidAfter;
        emit ReferenceActivated(proposedTick, uint64(block.timestamp));
    }

    function cancelReferenceProposal() external onlyOwner {
        if (pendingReferenceValidAfter == 0) revert InvalidProposal();
        delete pendingReferenceTick;
        delete pendingReferenceValidAfter;
        emit ReferenceProposalCancelled();
    }

    /// @notice Returns the delayed activated reference quote as 18-decimal AZL per ETH.
    /// @dev Live TWAP, spot, liquidity, and reference freshness are validation gates only;
    ///      the returned valuation is economically independent of the current execution price.
    function azlPerEth() external view returns (uint256 amount) {
        uint64 activatedAt = referenceActivatedAt;
        if (activatedAt == 0 || block.timestamp > uint256(activatedAt) + REFERENCE_MAX_AGE) revert NotReady();
        int24 meanTick = observationOracle.consult();
        _validateLivePool(meanTick);
        if (_absoluteTickDelta(meanTick, referenceTick) > MAX_REFERENCE_TICK_DEVIATION) revert NotReady();

        amount = _quoteAtTick(referenceTick, uint128(WAD));
        if (amount == 0) revert NotReady();
    }

    /// @dev Accepted Risk (deliberate trade-off): unlike activateReference(), this owner-only fast path
    ///      skips both the 24h delay and the MAX_REFERENCE_TICK_DEVIATION check against the outgoing
    ///      reference. It exists so governance can re-baseline quickly after a legitimate, verified
    ///      market move without waiting a full day. The cost is that a manipulated AzlV4ObservationOracle
    ///      checkpoint (see that contract's own record() note) could bias a well-intentioned roll.
    ///      Mitigated operationally: the caller is expected to sanity-check the proposed tick against
    ///      an independent price source before calling, same as proposeReference()'s existing note requires.
    function rollReference() external onlyOwner {
        require(referenceActivatedAt != 0, "AzlTwap: not initialized");
        int24 meanTick = observationOracle.consult();
        _validateLivePool(meanTick);
        referenceTick = meanTick;
        referenceActivatedAt = uint64(block.timestamp);
        emit ReferenceActivated(meanTick, uint64(block.timestamp));
    }

    function activeLiquidity() public view returns (uint128 liquidity) {
        bytes32 stateSlot = keccak256(abi.encode(poolId, POOLS_SLOT));
        bytes32 value = poolManager.extsload(bytes32(uint256(stateSlot) + LIQUIDITY_OFFSET));
        liquidity = uint128(uint256(value));
    }

    /// @notice Fails closed for stale observations/reference, low liquidity, malformed pool state, and deviation.
    function isReady() external view returns (bool) {
        try this.azlPerEth() returns (uint256 amount) {
            return amount != 0;
        } catch {
            return false;
        }
    }

    function _validateLivePool(int24 meanTick) private view {
        (uint160 sqrtPriceX96, int24 spotTick) = _slot0();
        if (
            sqrtPriceX96 == 0
                || (
                    TickMath.getTickAtSqrtPrice(sqrtPriceX96) != spotTick
                        && TickMath.getTickAtSqrtPrice(sqrtPriceX96) != spotTick + 1
                )
                || activeLiquidity() < minimumActiveLiquidity
                || _absoluteTickDelta(spotTick, meanTick) > MAX_SPOT_TWAP_TICK_DEVIATION
        ) revert NotReady();
    }

    function _absoluteTickDelta(int24 a, int24 b) private pure returns (int256 delta) {
        delta = int256(a) - int256(b);
        if (delta < 0) delta = -delta;
    }

    /// @dev Base PoolManager provides raw pool storage through `extsload`; the
    ///      StateLibrary `getSlot0` convenience function is not an external method.
    function _slot0() private view returns (uint160 sqrtPriceX96, int24 tick) {
        bytes32 stateSlot = keccak256(abi.encode(poolId, POOLS_SLOT));
        uint256 packed = uint256(poolManager.extsload(stateSlot));
        sqrtPriceX96 = uint160(packed);
        tick = int24(uint24(packed >> 160));
    }

    function _quoteAtTick(int24 tick, uint128 baseAmount) private pure returns (uint256 quoteAmount) {
        uint160 sqrtPriceX96 = TickMath.getSqrtPriceAtTick(tick);
        if (sqrtPriceX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
            quoteAmount = FullMath.mulDivRoundingUp(ratioX192, baseAmount, 1 << 192);
        } else {
            uint256 ratioX128 = FullMath.mulDivRoundingUp(sqrtPriceX96, sqrtPriceX96, 1 << 64);
            quoteAmount = FullMath.mulDivRoundingUp(ratioX128, baseAmount, 1 << 128);
        }
    }
}
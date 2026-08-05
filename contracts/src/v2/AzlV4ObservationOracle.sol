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

import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";
import {V4PoolKey} from "./V4PoolKey.sol";

/// @notice Permissionless tick accumulator for one immutable Uniswap V4 pool.
/// @dev V4's PoolManager exposes the current tick, not V3-style historical
///      observations. Call `record()` periodically; callers cannot supply ticks.
contract AzlV4ObservationOracle {
    using V4PoolKey for V4PoolKey.PoolKey;
    error NotReady();
    error SameBlock();
    error InvalidWindow();
    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));

    struct Observation {
        uint64 timestamp;
        int24 tick;
        int56 tickCumulative;
    }

    IV4PoolManager public immutable poolManager;
    bytes32 public immutable poolId;
    uint32 public immutable twapWindow;
    uint32 public immutable maxObservationGap;
    Observation[] private _observations;
    uint256 public epochStartIndex;

    event ObservationRecorded(uint64 indexed timestamp, int24 tick, int56 tickCumulative);
    event ObservationEpochStarted(uint256 indexed startIndex, uint64 indexed timestamp);

    constructor(
        address _poolManager,
        V4PoolKey.PoolKey memory key,
        uint32 _twapWindow,
        uint32 _maxObservationGap
    ) {
        require(_poolManager.code.length != 0, "V4Observer: manager");
        require(
            key.currency0 == 0x4200000000000000000000000000000000000006
                && key.currency1 == 0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3,
            "V4Observer: currencies"
        );
        require(key.fee == 0x800000 && key.tickSpacing == 200, "V4Observer: pool params");
        require(key.hooks == 0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544, "V4Observer: hook");
        bytes32 id = key.toId();
        require(
            id == 0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad,
            "V4Observer: id"
        );
        require(_twapWindow >= 30 minutes, "V4Observer: window");
        require(
            _maxObservationGap > 0 && _maxObservationGap <= _twapWindow / 4,
            "V4Observer: gap"
        );
        poolManager = IV4PoolManager(_poolManager);
        poolId = id;
        twapWindow = _twapWindow;
        maxObservationGap = _maxObservationGap;
    }

    function observationCount() external view returns (uint256) {
        return _observations.length;
    }

    function latestObservation() external view returns (Observation memory) {
        uint256 length = _observations.length;
        if (length == 0) revert NotReady();
        return _observations[length - 1];
    }

    /// @notice Permissionless pool tick checkpoint for TWAP consultation downstream.
    /// @dev Accepted Risk (deliberate trade-off): checkpoints are accepted with no per-call deviation
    ///      bound against the prior recorded tick. Adding one would require an oracle-of-an-oracle to
    ///      define "reasonable" movement, reintroducing the exact centralization this contract exists
    ///      to avoid. The mitigation is structural, not per-call: AzlEthTwapAdapter's downstream
    ///      _validateLivePool deviation gate and AzlUsdOracle's haircut bound the practical impact of
    ///      any single poisoned checkpoint on quoted prices. Keepers should call frequently (target:
    ///      every block) so no checkpoint accumulates outsized weight.
    function record() external {
        (, int24 tick) = _slot0();
        uint64 nowTime = uint64(block.timestamp);
        uint256 length = _observations.length;
        if (length == 0) {
            _observations.push(Observation({timestamp: nowTime, tick: tick, tickCumulative: 0}));
            emit ObservationEpochStarted(0, nowTime);
            emit ObservationRecorded(nowTime, tick, 0);
            return;
        }

        Observation memory previous = _observations[length - 1];
        if (previous.timestamp == nowTime) revert SameBlock();
        uint64 elapsed = nowTime - previous.timestamp;
        if (elapsed > maxObservationGap) {
            epochStartIndex = length;
            _observations.push(Observation({timestamp: nowTime, tick: tick, tickCumulative: 0}));
            emit ObservationEpochStarted(length, nowTime);
            emit ObservationRecorded(nowTime, tick, 0);
            return;
        }

        int56 cumulative = previous.tickCumulative + int56(previous.tick) * int56(uint56(elapsed));
        _observations.push(Observation({timestamp: nowTime, tick: tick, tickCumulative: cumulative}));
        emit ObservationRecorded(nowTime, tick, cumulative);
    }

    function consult() external view returns (int24 arithmeticMeanTick) {
        uint256 length = _observations.length;
        uint256 startIndex = epochStartIndex;
        if (length - startIndex < 2) revert NotReady();

        Observation memory latest = _observations[length - 1];
        if (block.timestamp > latest.timestamp + maxObservationGap) revert NotReady();

        Observation memory epochStart = _observations[startIndex];
        if (latest.timestamp - epochStart.timestamp < twapWindow) revert NotReady();
        uint64 target = latest.timestamp - twapWindow;
        Observation memory beforeOrAt = _observationAtOrBefore(startIndex, length, target);
        if (beforeOrAt.timestamp == latest.timestamp) revert InvalidWindow();

        int56 cumulativeAtTarget = beforeOrAt.tickCumulative;
        if (beforeOrAt.timestamp < target) {
            cumulativeAtTarget +=
                int56(beforeOrAt.tick) * int56(uint56(target - beforeOrAt.timestamp));
        }

        int56 delta = latest.tickCumulative - cumulativeAtTarget;
        int56 window = int56(uint56(twapWindow));
        arithmeticMeanTick = int24(delta / window);
        if (delta < 0 && (delta % window != 0)) --arithmeticMeanTick;
    }

    function _observationAtOrBefore(uint256 low, uint256 high, uint64 target)
        private
        view
        returns (Observation memory)
    {
        while (low < high) {
            uint256 mid = low + (high - low) / 2;
            if (_observations[mid].timestamp <= target) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        return _observations[low - 1];
    }

    /// @dev Base's PoolManager exposes pool storage through `extsload`; it does not
    ///      implement StateLibrary's `getSlot0` helper as an external entrypoint.
    function _slot0() private view returns (uint160 sqrtPriceX96, int24 tick) {
        bytes32 stateSlot = keccak256(abi.encode(poolId, POOLS_SLOT));
        uint256 packed = uint256(poolManager.extsload(stateSlot));
        sqrtPriceX96 = uint160(packed);
        tick = int24(uint24(packed >> 160));
    }
}
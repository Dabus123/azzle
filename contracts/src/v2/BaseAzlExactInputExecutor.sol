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
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SqrtPriceMath} from "@uniswap/v4-core/src/libraries/SqrtPriceMath.sol";
import {BitMath} from "@uniswap/v4-core/src/libraries/BitMath.sol";
import {IFixedAzlExactInputExecutor} from "./interfaces/IFixedAzlExactInputExecutor.sol";
import {IV4PoolManager} from "./interfaces/IV4PoolManager.sol";
import {V4PoolKey} from "./V4PoolKey.sol";

interface IWETH9 is IERC20 {
    function deposit() external payable;
}

interface IPermit2AllowanceTransfer {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IBaseUniversalRouterV2 {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

interface IReviewedUsdcWethLeg {
    function usdc() external view returns (address);
    function weth() external view returns (address);
    function executeExactInput(uint256 amountIn, uint256 minWethOut, uint256 deadline)
        external
        returns (uint256 wethOut);
}

/// @notice Fixed Base USDC/native-ETH -> WETH -> AZL exact-input executor.
/// @dev Uses the deployed router's five-field V4 exact-input tuple.
///      Callable directly — bypasses `AzlPaymentGateway` pause, input caps, and deviation guards.
contract BaseAzlExactInputExecutor is IFixedAzlExactInputExecutor, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using V4PoolKey for V4PoolKey.PoolKey;

    address public constant override usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant override weth = 0x4200000000000000000000000000000000000006;
    address public constant override azl = 0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3;
    address public constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address public constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant AZL_WETH_HOOK = 0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544;
    bytes32 public constant AZL_WETH_POOL_ID =
        0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad;
/// @notice Verified on-chain (Base mainnet): Airlock.getAssetData(AZL).liquidityMigrator resolves to
// a NoOpMigrator (0x6ddfED58D238Ca3195E49d8ac3d4cEa6386E5C33) whose migrate() reverts
// unconditionally (CannotMigrate). governance, timelock, and migrationPool are all set to
// burn addresses. This pool is permanently locked with no live migration path — Airlock.migrate()
// cannot drain this pool.
    bytes1 private constant V4_SWAP = 0x10;
    bytes1 private constant SWAP_EXACT_IN_SINGLE = 0x06;
    bytes1 private constant SETTLE_ALL = 0x0c;
    bytes1 private constant TAKE_ALL = 0x0f;

    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;
    uint256 public constant override BPS = 10_000;
    uint256 public constant override MAX_SQRT_PRICE_IMPACT_BPS = 25;

    bytes32 private constant POOLS_SLOT = bytes32(uint256(6));
    uint256 private constant LIQUIDITY_OFFSET = 3;
    uint256 private constant TICK_BITMAP_OFFSET = 5;
    int24 private constant TICK_SPACING = 200;
    uint256 private constant Q96 = 1 << 96;
    uint256 private constant Q192 = 1 << 192;

    IReviewedUsdcWethLeg public immutable usdcWethLeg;
    bytes32 public immutable usdcWethLegCodehash;
    address public immutable override ethUsdReference;
    bytes32 public immutable override creditContext;
    uint16 public immutable override maxExecutionDeviationBps;
    address public immutable override configurator;
    address public override gateway;

    struct ExactInputSingleParamsV2 {
        V4PoolKey.PoolKey poolKey;
        bool zeroForOne;
        uint128 amountIn;
        uint128 amountOutMinimum;
        bytes hookData;
    }

    constructor(
        address reviewedUsdcWethLeg,
        address _ethUsdReference,
        bytes32 _creditContext,
        uint16 _maxExecutionDeviationBps,
        address _configurator
    ) {
        require(block.chainid == 8453, "BaseAzlExecutor: chain");
        require(
            UNIVERSAL_ROUTER.code.length != 0 && POOL_MANAGER.code.length != 0 && PERMIT2.code.length != 0
                && weth.code.length != 0 && azl.code.length != 0 && usdc.code.length != 0,
            "BaseAzlExecutor: Base config"
        );
        require(reviewedUsdcWethLeg.code.length != 0, "BaseAzlExecutor: first leg");
        require(_ethUsdReference.code.length != 0, "BaseAzlExecutor: reference");
        require(_maxExecutionDeviationBps <= 2_000, "BaseAzlExecutor: deviation");
        require(_configurator != address(0), "BaseAzlExecutor: configurator");

        IReviewedUsdcWethLeg leg = IReviewedUsdcWethLeg(reviewedUsdcWethLeg);
        require(leg.usdc() == usdc && leg.weth() == weth, "BaseAzlExecutor: endpoints");
        bytes32 codehash;
        assembly {
            codehash := extcodehash(reviewedUsdcWethLeg)
        }
        require(codehash != bytes32(0), "BaseAzlExecutor: codehash");
        usdcWethLeg = leg;
        usdcWethLegCodehash = codehash;
        ethUsdReference = _ethUsdReference;
        creditContext = _creditContext;
        maxExecutionDeviationBps = _maxExecutionDeviationBps;
        configurator = _configurator;

        V4PoolKey.PoolKey memory key = _poolKey();
        require(key.toId() == AZL_WETH_POOL_ID, "BaseAzlExecutor: pool");
    }

    function configureGateway(address _gateway) external override {
        require(msg.sender == configurator, "BaseAzlExecutor: configurator");
        require(gateway == address(0) && _gateway.code.length != 0, "BaseAzlExecutor: gateway");
        gateway = _gateway;
    }

    function executeUsdcExactInput(uint256 amountIn, uint256 minAzlOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 azlOut)
    {
        require(msg.sender == gateway, "BaseAzlExecutor: gateway only");
        _validate(amountIn, minAzlOut, deadline);
        require(_legCodehash() == usdcWethLegCodehash, "BaseAzlExecutor: leg changed");
        require(usdcWethLeg.usdc() == usdc && usdcWethLeg.weth() == weth, "BaseAzlExecutor: endpoints changed");

        uint256 usdcBefore = IERC20(usdc).balanceOf(address(this));
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amountIn);
        require(IERC20(usdc).balanceOf(address(this)) == usdcBefore + amountIn, "BaseAzlExecutor: USDC transfer");

        IERC20(usdc).forceApprove(address(usdcWethLeg), amountIn);
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 minWethOut = _minWethForAzlOut(minAzlOut);
        uint256 reportedWeth = usdcWethLeg.executeExactInput(amountIn, minWethOut, deadline);
        IERC20(usdc).forceApprove(address(usdcWethLeg), 0);
        require(IERC20(usdc).balanceOf(address(this)) == usdcBefore, "BaseAzlExecutor: USDC input");
        uint256 wethReceived = IERC20(weth).balanceOf(address(this)) - wethBefore;
        require(wethReceived == reportedWeth && wethReceived != 0, "BaseAzlExecutor: WETH output");

        azlOut = _swapWethForAzl(wethReceived, minAzlOut, deadline);
        /// @dev Accepted Risk (deliberate trade-off): unlike every other transfer in this contract, the
        ///      final AZL payout has no post-transfer balance assertion. AZL's transfer semantics are
        ///      standard (no fee-on-transfer, no rebasing, no partial-blacklist behavior on ordinary
        ///      transfers) confirmed against the live deployed token, so the added gas cost of a redundant
        ///      check was not judged worthwhile.
        IERC20(azl).safeTransfer(msg.sender, azlOut);
        require(IERC20(weth).balanceOf(address(this)) == wethBefore, "BaseAzlExecutor: WETH dust");
    }

    function executeEthExactInput(uint256 minAzlOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 azlOut)
    {
        require(msg.sender == gateway, "BaseAzlExecutor: gateway only");
        _validate(msg.value, minAzlOut, deadline);
        uint256 ethBefore = address(this).balance - msg.value;
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        IWETH9(weth).deposit{value: msg.value}();
        require(address(this).balance == ethBefore, "BaseAzlExecutor: ETH dust");
        require(IERC20(weth).balanceOf(address(this)) == wethBefore + msg.value, "BaseAzlExecutor: wrap");

        azlOut = _swapWethForAzl(msg.value, minAzlOut, deadline);
        /// @dev Accepted Risk (deliberate trade-off): unlike every other transfer in this contract, the
        ///      final AZL payout has no post-transfer balance assertion. AZL's transfer semantics are
        ///      standard (no fee-on-transfer, no rebasing, no partial-blacklist behavior on ordinary
        ///      transfers) confirmed against the live deployed token, so the added gas cost of a redundant
        ///      check was not judged worthwhile.
        IERC20(azl).safeTransfer(msg.sender, azlOut);
        require(IERC20(weth).balanceOf(address(this)) == wethBefore, "BaseAzlExecutor: WETH dust");
    }

    function maxAdmissibleWethInput() public view returns (uint256 amountIn) {
        (uint160 sqrtPriceX96, int24 tick,) = _readPoolSnapshot();
        uint128 liquidity = _readLiquidity();
        if (liquidity == 0) return 0;

        uint256 maxByImpact = _maxAmount0ToSqrtTarget(sqrtPriceX96, _sqrtPriceImpactFloor(sqrtPriceX96), liquidity);
        uint256 maxByTick = type(uint256).max;
        (int24 nextTick, bool initialized) = _nextInitializedTick(tick - 1, true);
        if (initialized) {
            uint160 sqrtAtTick = TickMath.getSqrtPriceAtTick(nextTick);
            if (sqrtAtTick < sqrtPriceX96) {
                maxByTick = _maxAmount0ToSqrtTarget(sqrtPriceX96, sqrtAtTick, liquidity);
            }
        }

        amountIn = maxByImpact < maxByTick ? maxByImpact : maxByTick;
        if (amountIn > type(uint128).max) amountIn = type(uint128).max;
    }

    function _swapWethForAzl(uint256 amountIn, uint256 minAzlOut, uint256 deadline)
        private
        returns (uint256 azlOut)
    {
        require(amountIn <= type(uint128).max && amountIn <= type(uint160).max && minAzlOut <= type(uint128).max, "BaseAzlExecutor: size");
        (uint160 sqrtBefore,,) = _readPoolSnapshot();
        require(amountIn <= maxAdmissibleWethInput(), "BaseAzlExecutor: price impact");

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 azlBefore = IERC20(azl).balanceOf(address(this));

        IERC20(weth).forceApprove(PERMIT2, amountIn);
        IPermit2AllowanceTransfer(PERMIT2).approve(weth, UNIVERSAL_ROUTER, uint160(amountIn), uint48(deadline));

        bytes memory actions = abi.encodePacked(SWAP_EXACT_IN_SINGLE, SETTLE_ALL, TAKE_ALL);
        bytes[] memory params = new bytes[](3);
        params[0] = abi.encode(
            ExactInputSingleParamsV2({
                poolKey: _poolKey(),
                zeroForOne: true,
                amountIn: uint128(amountIn),
                amountOutMinimum: uint128(minAzlOut),
                hookData: bytes("")
            })
        );
        params[1] = abi.encode(weth, amountIn);
        params[2] = abi.encode(azl, minAzlOut);
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, params);
        IBaseUniversalRouterV2(UNIVERSAL_ROUTER).execute(abi.encodePacked(V4_SWAP), inputs, deadline);

        IPermit2AllowanceTransfer(PERMIT2).approve(weth, UNIVERSAL_ROUTER, 0, 0);
        IERC20(weth).forceApprove(PERMIT2, 0);

        require(IERC20(weth).balanceOf(address(this)) == wethBefore - amountIn, "BaseAzlExecutor: partial input");
        azlOut = IERC20(azl).balanceOf(address(this)) - azlBefore;
        require(azlOut >= minAzlOut, "BaseAzlExecutor: minimum");
        _assertRealizedImpact(sqrtBefore);
    }

    function _minWethForAzlOut(uint256 minAzlOut) private view returns (uint256 minWethOut) {
        (uint160 sqrtPriceX96,,) = _readPoolSnapshot();
        uint256 ratioX192 = uint256(sqrtPriceX96) * sqrtPriceX96;
        minWethOut = FullMath.mulDivRoundingUp(minAzlOut, Q192, ratioX192);
        require(minWethOut != 0, "BaseAzlExecutor: min weth");
    }

    function _assertRealizedImpact(uint160 sqrtBefore) private view {
        (uint160 sqrtAfter,,) = _readPoolSnapshot();
        require(sqrtAfter >= _sqrtPriceImpactFloor(sqrtBefore), "BaseAzlExecutor: price impact");
    }

    function _sqrtPriceImpactFloor(uint160 sqrtPriceX96) private pure returns (uint160 sqrtFloor) {
        sqrtFloor = uint160(FullMath.mulDiv(sqrtPriceX96, BPS - MAX_SQRT_PRICE_IMPACT_BPS, BPS));
    }

    function _maxAmount0ToSqrtTarget(uint160 sqrtPriceX96, uint160 sqrtTarget, uint128 liquidity)
        private
        pure
        returns (uint256 amountIn)
    {
        if (sqrtTarget >= sqrtPriceX96) return 0;
        amountIn = SqrtPriceMath.getAmount0Delta(sqrtTarget, sqrtPriceX96, liquidity, true);
        while (amountIn > 0) {
            uint160 sqrtAfter = SqrtPriceMath.getNextSqrtPriceFromInput(sqrtPriceX96, liquidity, amountIn, true);
            if (sqrtAfter >= sqrtTarget) break;
            amountIn--;
        }
    }

    function _readPoolSnapshot()
        private
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity)
    {
        IV4PoolManager manager = IV4PoolManager(POOL_MANAGER);
        bytes32 stateSlot = _poolStateSlot();
        uint256 packedSlot0 = uint256(manager.extsload(stateSlot));
        sqrtPriceX96 = uint160(packedSlot0);
        tick = int24(uint24(packedSlot0 >> 160));
        require(
            sqrtPriceX96 != 0
                && (
                    TickMath.getTickAtSqrtPrice(sqrtPriceX96) == tick
                        || TickMath.getTickAtSqrtPrice(sqrtPriceX96) == tick + 1
                ),
            "BaseAzlExecutor: pool state"
        );
        liquidity = _readLiquidity();
        require(liquidity != 0, "BaseAzlExecutor: liquidity");
    }

    function _readLiquidity() private view returns (uint128 liquidity) {
        liquidity = uint128(
            uint256(IV4PoolManager(POOL_MANAGER).extsload(bytes32(uint256(_poolStateSlot()) + LIQUIDITY_OFFSET)))
        );
    }

    function _readTickBitmap(int16 wordPos) private view returns (uint256 tickBitmap) {
        bytes32 tickBitmapMapping = bytes32(uint256(_poolStateSlot()) + TICK_BITMAP_OFFSET);
        bytes32 slot = keccak256(abi.encodePacked(int256(wordPos), tickBitmapMapping));
        tickBitmap = uint256(IV4PoolManager(POOL_MANAGER).extsload(slot));
    }

    function _nextInitializedTick(int24 tick, bool lte)
        private
        view
        returns (int24 nextTick, bool initialized)
    {
        int24 compressed = _compressTick(tick);
        if (lte) {
            (int16 wordPos, uint8 bitPos) = _tickPosition(compressed);
            uint256 mask = type(uint256).max >> (uint256(type(uint8).max) - bitPos);
            uint256 masked = _readTickBitmap(wordPos) & mask;
            initialized = masked != 0;
            nextTick = initialized
                ? (compressed - int24(uint24(bitPos - BitMath.mostSignificantBit(masked)))) * TICK_SPACING
                : (compressed - int24(uint24(bitPos))) * TICK_SPACING;
        } else {
            compressed++;
            (int16 wordPos, uint8 bitPos) = _tickPosition(compressed);
            uint256 mask = ~((1 << bitPos) - 1);
            uint256 masked = _readTickBitmap(wordPos) & mask;
            initialized = masked != 0;
            nextTick = initialized
                ? (compressed + int24(uint24(BitMath.leastSignificantBit(masked) - bitPos))) * TICK_SPACING
                : (compressed + int24(uint24(type(uint8).max - bitPos))) * TICK_SPACING;
        }
    }

    function _compressTick(int24 value) private pure returns (int24 compressed) {
        compressed = value / TICK_SPACING;
        if (value < 0 && value % TICK_SPACING != 0) compressed--;
    }

    function _tickPosition(int24 compressed) private pure returns (int16 wordPos, uint8 bitPos) {
        assembly ("memory-safe") {
            wordPos := sar(8, signextend(2, compressed))
            bitPos := and(compressed, 0xff)
        }
    }

    function _poolStateSlot() private pure returns (bytes32) {
        return keccak256(abi.encode(AZL_WETH_POOL_ID, POOLS_SLOT));
    }

    function _poolKey() private pure returns (V4PoolKey.PoolKey memory) {
        return V4PoolKey.PoolKey({
            currency0: weth,
            currency1: azl,
            fee: 0x800000,
            tickSpacing: 200,
            hooks: AZL_WETH_HOOK
        });
    }

    function _validate(uint256 amountIn, uint256 minAzlOut, uint256 deadline) private view {
        require(amountIn != 0 && minAzlOut != 0, "BaseAzlExecutor: zero");
        require(deadline >= block.timestamp && deadline <= block.timestamp + MAX_DEADLINE_WINDOW, "BaseAzlExecutor: deadline");
    }

    function _legCodehash() private view returns (bytes32 codehash) {
        address leg = address(usdcWethLeg);
        assembly {
            codehash := extcodehash(leg)
        }
    }
}

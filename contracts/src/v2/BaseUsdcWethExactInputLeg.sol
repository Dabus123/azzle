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

interface IBaseV3Pool {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

interface IPermit2AllowanceTransferLeg {
    function approve(address token, address spender, uint160 amount, uint48 expiration) external;
}

interface IBaseUniversalRouterLeg {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Fixed, adminless Base USDC -> WETH Uniswap V3 exact-input leg.
/// @dev The only route is canonical Base USDC/0.05%/WETH. Output returns to the caller.
contract BaseUsdcWethExactInputLeg is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant weth = 0x4200000000000000000000000000000000000006;
    address public constant UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address public constant V3_POOL = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    uint24 public constant V3_FEE = 500;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;

    bytes1 private constant V3_SWAP_EXACT_IN = 0x00;

    constructor() {
        require(block.chainid == 8453, "BaseUsdcWethLeg: chain");
        require(
            usdc.code.length != 0 && weth.code.length != 0 && UNIVERSAL_ROUTER.code.length != 0
                && PERMIT2.code.length != 0 && V3_FACTORY.code.length != 0 && V3_POOL.code.length != 0,
            "BaseUsdcWethLeg: config"
        );
        IBaseV3Pool pool = IBaseV3Pool(V3_POOL);
        require(
            pool.factory() == V3_FACTORY && pool.token0() == weth && pool.token1() == usdc && pool.fee() == V3_FEE,
            "BaseUsdcWethLeg: pool"
        );
    }

    function executeExactInput(uint256 amountIn, uint256 minWethOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 wethOut)
    {
        require(amountIn != 0 && minWethOut != 0 && amountIn <= type(uint160).max, "BaseUsdcWethLeg: amount");
        require(deadline >= block.timestamp && deadline <= block.timestamp + MAX_DEADLINE_WINDOW, "BaseUsdcWethLeg: deadline");

        uint256 usdcBefore = IERC20(usdc).balanceOf(address(this));
        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amountIn);
        require(IERC20(usdc).balanceOf(address(this)) == usdcBefore + amountIn, "BaseUsdcWethLeg: input");

        IERC20(usdc).forceApprove(PERMIT2, amountIn);
        IPermit2AllowanceTransferLeg(PERMIT2).approve(usdc, UNIVERSAL_ROUTER, uint160(amountIn), uint48(deadline));

        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(this), amountIn, minWethOut, abi.encodePacked(usdc, V3_FEE, weth), true);
        IBaseUniversalRouterLeg(UNIVERSAL_ROUTER).execute(abi.encodePacked(V3_SWAP_EXACT_IN), inputs, deadline);

        IPermit2AllowanceTransferLeg(PERMIT2).approve(usdc, UNIVERSAL_ROUTER, 0, 0);
        IERC20(usdc).forceApprove(PERMIT2, 0);

        require(IERC20(usdc).balanceOf(address(this)) == usdcBefore, "BaseUsdcWethLeg: partial input");
        wethOut = IERC20(weth).balanceOf(address(this)) - wethBefore;
        require(wethOut >= minWethOut, "BaseUsdcWethLeg: output");
        IERC20(weth).safeTransfer(msg.sender, wethOut);
        require(IERC20(weth).balanceOf(address(this)) == wethBefore, "BaseUsdcWethLeg: WETH dust");
    }
}

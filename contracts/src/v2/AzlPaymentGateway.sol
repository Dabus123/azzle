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
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAzlUsdOracle} from "./interfaces/IAzlUsdOracle.sol";
import {IFixedAzlExactInputExecutor} from "./interfaces/IFixedAzlExactInputExecutor.sol";

interface IAzlCreditVault {
    function azl() external view returns (IERC20);
    function credit(address account, uint256 amount, bytes32 context) external;
}

/// @notice V2 exact-input boundary for fixed-route AZL purchases.
/// @dev Every successful payment credits the payer; no caller-selected route,
///      recipient, credit account, or context exists.
///      `intakePaused` applies to gateway entrypoints only — direct `BaseAzlExactInputExecutor`
///      swaps bypass pause, caps, and deviation guards (intentional scope: user-facing intake kill-switch).
contract AzlPaymentGateway is V2Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_USDC_INPUT6 = 500_000_000;
    uint256 public constant MAX_ETH_INPUT = 10 ether;
    uint256 public constant MAX_DEADLINE_WINDOW = 10 minutes;
    uint256 private constant BPS = 10_000;

    IERC20 public immutable usdc;
    IERC20 public immutable azl;
    IAzlUsdOracle public immutable oracle;
    IFixedAzlExactInputExecutor public immutable executor;
    address public immutable custodyVault;
    bytes32 public immutable creditContext;
    uint16 public immutable maxExecutionDeviationBps;
    bool public intakePaused = true;

    event PaymentFunded(
        address indexed payer,
        address indexed inputToken,
        uint256 exactInput,
        uint256 inputUsd6,
        uint256 azlReceived,
        address indexed creditAccount,
        bytes32 context
    );
    event IntakePaused(bool paused);

    modifier whenIntakeOpen() {
        require(!intakePaused, "AzlGateway: paused");
        _;
    }

    constructor(
        address _usdc,
        address _azl,
        address _oracle,
        address _executor,
        address _custodyVault,
        address initialOwner
    ) V2Ownable2Step(initialOwner) {
        require(
            _usdc.code.length != 0 && _azl.code.length != 0 && _oracle.code.length != 0
                && _executor.code.length != 0 && _custodyVault.code.length != 0,
            "AzlGateway: config"
        );
        IFixedAzlExactInputExecutor fixedExecutor = IFixedAzlExactInputExecutor(_executor);
        require(fixedExecutor.usdc() == _usdc && fixedExecutor.azl() == _azl, "AzlGateway: executor");
        require(fixedExecutor.ethUsdReference() == _oracle, "AzlGateway: reference");
        require(address(IAzlCreditVault(_custodyVault).azl()) == _azl, "AzlGateway: vault token");
        uint16 configuredDeviation = fixedExecutor.maxExecutionDeviationBps();
        require(configuredDeviation <= 2_000, "AzlGateway: deviation");
        usdc = IERC20(_usdc);
        azl = IERC20(_azl);
        oracle = IAzlUsdOracle(_oracle);
        executor = fixedExecutor;
        custodyVault = _custodyVault;
        creditContext = fixedExecutor.creditContext();
        maxExecutionDeviationBps = configuredDeviation;
    }

    /// @dev Pauses `fundWithUsdc` / `fundWithEth` only; does not pause protocol task actions or direct executor use.
    function setIntakePaused(bool paused) external onlyOwner {
        intakePaused = paused;
        emit IntakePaused(paused);
    }

    function fundWithUsdc(uint256 exactUsdcIn, uint256 minAzlOut, uint256 deadline)
        external
        nonReentrant
        whenIntakeOpen
        returns (uint256 azlReceived)
    {
        _validateCommon(exactUsdcIn, minAzlOut, deadline);
        uint256 usdcDepthCap = oracle.quoteEthUsd6(executor.maxAdmissibleWethInput());
        require(exactUsdcIn <= MAX_USDC_INPUT6 && exactUsdcIn <= usdcDepthCap, "AzlGateway: input cap");
        uint256 usdcBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), exactUsdcIn);
        require(usdc.balanceOf(address(this)) == usdcBefore + exactUsdcIn, "AzlGateway: USDC transfer");

        usdc.forceApprove(address(executor), exactUsdcIn);
        uint256 azlBefore = azl.balanceOf(address(this));
        uint256 reported = executor.executeUsdcExactInput(exactUsdcIn, minAzlOut, deadline);
        usdc.forceApprove(address(executor), 0);
        require(usdc.balanceOf(address(this)) == usdcBefore, "AzlGateway: USDC dust");
        azlReceived = azl.balanceOf(address(this)) - azlBefore;
        require(reported == azlReceived && azlReceived >= minAzlOut, "AzlGateway: AZL output");

        _guardAndCredit(msg.sender, exactUsdcIn, exactUsdcIn, azlBefore, azlReceived, address(usdc));
    }

    function fundWithEth(uint256 minAzlOut, uint256 deadline)
        external
        payable
        nonReentrant
        whenIntakeOpen
        returns (uint256 azlReceived)
    {
        _validateCommon(msg.value, minAzlOut, deadline);
        uint256 wethDepthCap = executor.maxAdmissibleWethInput();
        require(msg.value <= MAX_ETH_INPUT && msg.value <= wethDepthCap, "AzlGateway: input cap");
        uint256 inputUsd6 = oracle.quoteEthUsd6(msg.value);
        require(inputUsd6 != 0 && inputUsd6 <= MAX_USDC_INPUT6, "AzlGateway: input cap");
        uint256 ethBefore = address(this).balance - msg.value;
        uint256 azlBefore = azl.balanceOf(address(this));
        uint256 reported = executor.executeEthExactInput{value: msg.value}(minAzlOut, deadline);
        require(address(this).balance == ethBefore, "AzlGateway: ETH dust");
        azlReceived = azl.balanceOf(address(this)) - azlBefore;
        require(reported == azlReceived && azlReceived >= minAzlOut, "AzlGateway: AZL output");

        _guardAndCredit(msg.sender, msg.value, inputUsd6, azlBefore, azlReceived, address(0));
    }

    function _validateCommon(uint256 inputAmount, uint256 minAzlOut, uint256 deadline) private view {
        require(inputAmount != 0 && minAzlOut != 0, "AzlGateway: zero");
        require(deadline >= block.timestamp && deadline <= block.timestamp + MAX_DEADLINE_WINDOW, "AzlGateway: deadline");
        require(oracle.isValid(), "AzlGateway: oracle");
    }

    function _guardAndCredit(
        address payer,
        uint256 exactInput,
        uint256 inputUsd6,
        uint256 azlBefore,
        uint256 amount,
        address inputToken
    ) private {
        uint256 executionValue6 = oracle.quoteUsdForAzl(amount);
        uint256 minimumValue6 = Math.mulDiv(inputUsd6, BPS - maxExecutionDeviationBps, BPS);
        /// @dev Accepted Risk (deliberate trade-off): this guard is a floor only, with no matching ceiling.
        ///      `quoteUsdForAzl` applies the oracle haircut, so favorable pool prints can still credit
        ///      above the strict par reference. That is treated as bounded AMM arbitrage rather than
        ///      a fund-loss vector — credited AZL is always the exact amount actually swapped
        ///      in-transaction (verified by this function's own balance-delta checks), never drawn
        ///      from other depositors' balances.
        require(executionValue6 >= minimumValue6, "AzlGateway: execution deviation");

        uint256 vaultBefore = azl.balanceOf(custodyVault);
        azl.safeTransfer(custodyVault, amount);
        require(azl.balanceOf(address(this)) == azlBefore, "AzlGateway: AZL dust");
        require(azl.balanceOf(custodyVault) == vaultBefore + amount, "AzlGateway: vault transfer");
        IAzlCreditVault(custodyVault).credit(payer, amount, creditContext);
        emit PaymentFunded(payer, inputToken, exactInput, inputUsd6, amount, payer, creditContext);
    }
}

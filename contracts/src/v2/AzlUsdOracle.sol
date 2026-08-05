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
import {IAzlUsdOracle} from "./interfaces/IAzlUsdOracle.sol";

interface IAzlEthTwap {
    function azlPerEth() external view returns (uint256);
    function isReady() external view returns (bool);
}
interface IAggregatorV3 {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
interface ISequencerUptimeFeed {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
/// @notice Conservative AZL/USD quote source for V2 value-increasing actions.
/// @dev AZL/ETH valuation comes from the adapter's delayed activated reference; live pool data
///      is only a fail-closed validation gate. AZL amounts use 18 decimals; USD amounts use USDC's 6.
///      Accepted Risk (deliberate trade-off): this oracle stack depends on frequent, honest `record()`
///      checkpointing by permissionless keepers and on governance exercising care when calling
///      `rollReference()` (see that function's own accepted-risk note). No purely on-chain mechanism
///      enforces either; the fail-closed validation gates bound worst-case impact but do not eliminate
///      reliance on operational diligence.
contract AzlUsdOracle is IAzlUsdOracle {
    uint256 public constant USD6 = 1e6;
    uint256 public constant WAD = 1e18;
    uint256 public constant BPS = 10_000;
    uint16 public constant HAIRCUT_BPS = 2_000;
    uint8 public constant MAX_FEED_DECIMALS = 18;

    uint256 public immutable maxFeedAge;
    IAzlEthTwap public immutable azlEthTwap;
    IAggregatorV3 public immutable ethUsdFeed;
    ISequencerUptimeFeed public immutable sequencerUptimeFeed;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;

    constructor(
        address _azlEthTwap,
        address _ethUsdFeed,
        uint256 _maxFeedAge,
        address _sequencerUptimeFeed
    ) {
        require(_azlEthTwap.code.length != 0, "AzlOracle: twap");
        require(_ethUsdFeed.code.length != 0, "AzlOracle: feed");
        require(_maxFeedAge > 0, "AzlOracle: age");
        azlEthTwap = IAzlEthTwap(_azlEthTwap);
        ethUsdFeed = IAggregatorV3(_ethUsdFeed);
        require(_sequencerUptimeFeed.code.length != 0, "AzlOracle: sequencer");
        sequencerUptimeFeed = ISequencerUptimeFeed(_sequencerUptimeFeed);
        maxFeedAge = _maxFeedAge;
    }

    /// @notice Returns false rather than bubbling failures from either external source.
    function isValid() public view returns (bool) {
        (bool twapValid,) = _tryTwap();
        if (!twapValid) return false;
        (bool feedValid,) = _tryEthUsdWad();
        return feedValid;
    }

    /// @notice Quotes the AZL liability for a USD6 amount, rounding every division upward.
    function quoteAzlForUsd(uint256 usdAmount6) external view returns (uint256 azlAmount) {
        require(usdAmount6 != 0, "AzlOracle: zero");
        (uint256 azlPerEth, uint256 ethUsdWad) = _validatedPrices();

        // Inverting a 20% value haircut requires 100/80 = 1.25x tokens.
        // Perform one final upward division so intermediate rounding cannot
        // compound; the exact multiplier is BPS / (BPS - HAIRCUT_BPS).
        azlAmount = _mulDiv3RoundingUp(
            usdAmount6, azlPerEth, uint256(1e12) * BPS, ethUsdWad * (BPS - HAIRCUT_BPS)
        );
    }

    /// @notice Quotes ETH in USD6 from the same validated Chainlink feed, rounding down.
    function quoteEthUsd6(uint256 weiAmount) external view returns (uint256 usdAmount6) {
        require(weiAmount != 0, "AzlOracle: zero");
        (bool feedValid, uint256 ethUsdWad) = _tryEthUsdWad();
        require(feedValid, "AzlOracle: invalid");
        usdAmount6 = FullMath.mulDiv(weiAmount, ethUsdWad, 1e30);
    }
    /// @notice Quotes par USD6 value for AZL before the conservative haircut, rounding upward.
    /// @dev Used for liability-cap accounting, where understating even a fractional USD6 unit
    ///      would admit more exposure than the configured cap.
    function quoteUsdForAzlPar(uint256 azlAmount) public view returns (uint256 usdAmount6) {
        require(azlAmount != 0, "AzlOracle: zero");
        (uint256 azlPerEth, uint256 ethUsdWad) = _validatedPrices();
        uint256 usdValueWad = FullMath.mulDivRoundingUp(azlAmount, ethUsdWad, azlPerEth);
        usdAmount6 = FullMath.mulDivRoundingUp(usdValueWad, USD6, WAD);
    }

    /// @notice Quotes conservative USD6 value for AZL, rounding every division downward.
    function quoteUsdForAzl(uint256 azlAmount) external view returns (uint256 usdAmount6) {
        require(azlAmount != 0, "AzlOracle: zero");
        (uint256 azlPerEth, uint256 ethUsdWad) = _validatedPrices();

        uint256 usdValueWad = FullMath.mulDiv(azlAmount, ethUsdWad, azlPerEth);
        uint256 parAmount6 = FullMath.mulDiv(usdValueWad, USD6, WAD);
        usdAmount6 = FullMath.mulDiv(parAmount6, BPS - HAIRCUT_BPS, BPS);
    }

    function _mulDiv3RoundingUp(uint256 a, uint256 b, uint256 c, uint256 denominator)
        private
        pure
        returns (uint256 result)
    {
        uint256 quotient = FullMath.mulDiv(a, b, denominator);
        uint256 remainder = mulmod(a, b, denominator);
        // quotient*c cannot overflow unless the final mathematical result does.
        result = quotient * c + FullMath.mulDivRoundingUp(remainder, c, denominator);
    }

    function _validatedPrices() private view returns (uint256 azlPerEth, uint256 ethUsdWad) {
        (bool twapValid, uint256 twapPrice) = _tryTwap();
        (bool feedValid, uint256 feedPrice) = _tryEthUsdWad();
        require(twapValid && feedValid, "AzlOracle: invalid");
        return (twapPrice, feedPrice);
    }

    function _tryTwap() private view returns (bool valid, uint256 price) {
        try azlEthTwap.isReady() returns (bool ready) {
            if (!ready) return (false, 0);
        } catch {
            return (false, 0);
        }
        try azlEthTwap.azlPerEth() returns (uint256 value) {
            return value == 0 ? (false, 0) : (true, value);
        } catch {
            return (false, 0);
        }
    }

    function _tryEthUsdWad() private view returns (bool valid, uint256 priceWad) {
        try sequencerUptimeFeed.latestRoundData() returns (
            uint80,
            int256 answer,
            uint256 startedAt,
            uint256,
            uint80
        ) {
            if (answer != 0 || startedAt == 0 || block.timestamp < startedAt + SEQUENCER_GRACE_PERIOD) {
                return (false, 0);
            }
        } catch {
            return (false, 0);
        }
        uint8 feedDecimals;
        try ethUsdFeed.decimals() returns (uint8 value) {
            feedDecimals = value;
        } catch {
            return (false, 0);
        }
        if (feedDecimals > MAX_FEED_DECIMALS) return (false, 0);

        try ethUsdFeed.latestRoundData() returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        ) {
            if (
                roundId == 0 || answeredInRound < roundId || answer <= 0 || startedAt == 0 || updatedAt == 0
                    || startedAt > updatedAt || startedAt > block.timestamp || updatedAt > block.timestamp
                    || block.timestamp - updatedAt > maxFeedAge
            ) return (false, 0);

            uint256 scale = 10 ** uint256(MAX_FEED_DECIMALS - feedDecimals);
            uint256 unsignedAnswer = uint256(answer);
            if (unsignedAnswer > type(uint256).max / scale) return (false, 0);
            priceWad = unsignedAnswer * scale;
            return priceWad == 0 ? (false, 0) : (true, priceWad);
        } catch {
            return (false, 0);
        }
    }
}


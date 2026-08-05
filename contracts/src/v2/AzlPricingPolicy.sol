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

import {IAzlUsdOracle} from "./interfaces/IAzlUsdOracle.sol";
import {IAzlV2Policy} from "./interfaces/IAzlV2Policy.sol";

/// @notice Immutable USD policy targets converted to AZL only before a new V2 liability is created.
contract AzlPricingPolicy is IAzlV2Policy {
    uint256 public constant ENTRY_DEPOSIT_USD6 = 25_000_000;
    uint256 public constant LIVE_TASK_RESERVE_USD6 = 8_000_000;
    uint256 public constant ACCESS_FEE_USD6 = 5_000_000;
    uint256 public constant EXIT_PARTY_COMP_USD6 = 2_500_000;
    uint256 public constant EXIT_PROTOCOL_SHARE_USD6 = 2_500_000;

    IAzlUsdOracle public immutable oracle;

    constructor(address _oracle) {
        require(_oracle.code.length != 0, "AzlPolicy: oracle");
        oracle = IAzlUsdOracle(_oracle);
    }

    /// @notice Produces one internally consistent quote from a single oracle observation.
    function quoteTask() external view returns (TaskQuote memory quote) {
        uint256 azlPerUsd6 = oracle.quoteAzlForUsd(1_000_000);
        require(azlPerUsd6 > 0, "AzlPolicy: quote");
        quote = TaskQuote({
            entryDeposit: _scale(ENTRY_DEPOSIT_USD6, azlPerUsd6),
            liveTaskReserve: _scale(LIVE_TASK_RESERVE_USD6, azlPerUsd6),
            accessFee: _scale(ACCESS_FEE_USD6, azlPerUsd6),
            exitCompensation: _scale(EXIT_PARTY_COMP_USD6, azlPerUsd6),
            exitProtocolShare: _scale(EXIT_PROTOCOL_SHARE_USD6, azlPerUsd6)
        });
    }

    function entryDepositAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(ENTRY_DEPOSIT_USD6);
    }

    function liveTaskReserveAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(LIVE_TASK_RESERVE_USD6);
    }

    function accessFeeAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(ACCESS_FEE_USD6);
    }

    function exitCompensationAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(EXIT_PARTY_COMP_USD6);
    }

    function exitProtocolShareAzl() external view returns (uint256) {
        return oracle.quoteAzlForUsd(EXIT_PROTOCOL_SHARE_USD6);
    }

    function _scale(uint256 usd6, uint256 azlPerUsd6) private pure returns (uint256) {
        return (usd6 * azlPerUsd6 + 1_000_000 - 1) / 1_000_000;
    }
}

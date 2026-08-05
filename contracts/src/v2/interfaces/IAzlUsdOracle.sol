// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAzlUsdOracle {
    function quoteAzlForUsd(uint256 usdAmount6) external view returns (uint256 azlAmount);
    function quoteUsdForAzl(uint256 azlAmount) external view returns (uint256 usdAmount6);
    /// @notice Returns the par USD6 liability for AZL, rounded upward.
    function quoteUsdForAzlPar(uint256 azlAmount) external view returns (uint256 usdAmount6);
    function quoteEthUsd6(uint256 weiAmount) external view returns (uint256 usdAmount6);
    function isValid() external view returns (bool);
}

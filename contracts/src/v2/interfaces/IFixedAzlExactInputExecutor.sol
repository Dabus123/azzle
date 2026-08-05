// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Narrow interface implemented by the one reviewed AZL exact-input executor.
/// @dev The gateway policy fields are immutable executor configuration.
interface IFixedAzlExactInputExecutor {
    function usdc() external view returns (address);
    function weth() external view returns (address);
    function azl() external view returns (address);
    function ethUsdReference() external view returns (address);
    function creditContext() external view returns (bytes32);
    function maxExecutionDeviationBps() external view returns (uint16);
    function gateway() external view returns (address);
    function configurator() external view returns (address);
    function BPS() external view returns (uint256);
    function MAX_SQRT_PRICE_IMPACT_BPS() external view returns (uint256);

    /// @notice Maximum WETH the AZL leg may consume at the current pool snapshot.
    function maxAdmissibleWethInput() external view returns (uint256);

    function configureGateway(address gateway) external;

    function executeUsdcExactInput(uint256 amountIn, uint256 minAzlOut, uint256 deadline)
        external
        returns (uint256 azlOut);

    function executeEthExactInput(uint256 minAzlOut, uint256 deadline)
        external
        payable
        returns (uint256 azlOut);
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IV4PoolManager {
    function extsload(bytes32 slot) external view returns (bytes32);
    /// @dev Uniswap V4 `StateLibrary.getSlot0` selector.
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

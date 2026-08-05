// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentDepositVault {
    function meetsEntryMinimum(address agent) external view returns (bool);
    function meetsTaskMinimum(address agent) external view returns (bool);
    function balanceOf(address agent) external view returns (uint256);
    function isBlocked(address agent) external view returns (bool);
    function MIN_TASK_BALANCE() external view returns (uint256);
    function MIN_ENTRY_BALANCE() external view returns (uint256);
    function usdcToken() external view returns (address);
}

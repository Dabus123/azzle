// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITaskScopeRegistry {
    event TaskScopeSet(uint256 indexed taskId, address indexed poster, bytes32 scopeHash);

    function taskRegistry() external view returns (address);

    function setScope(uint256 taskId, string calldata scope) external;

    function scopeOf(uint256 taskId) external view returns (string memory);
}

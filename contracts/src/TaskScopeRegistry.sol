// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITaskRegistry} from "./interfaces/ITaskRegistry.sol";
import {ITaskScopeRegistry} from "./interfaces/ITaskScopeRegistry.sol";

/// @title Onchain task scope text keyed by TaskRegistry task id
/// @notice Only the task poster (per TaskRegistry) may set or update scope for that task.
contract TaskScopeRegistry is ITaskScopeRegistry {
    address public immutable taskRegistry;

    /// @dev Upper bound on UTF-8 scope bytes to limit storage griefing.
    uint256 public constant MAX_SCOPE_BYTES = 8192;

    mapping(uint256 => string) private _scopes;

    constructor(address _taskRegistry) {
        require(_taskRegistry != address(0), "TaskScope: zero registry");
        taskRegistry = _taskRegistry;
    }

    /// @inheritdoc ITaskScopeRegistry
    function setScope(uint256 taskId, string calldata scope) external override {
        _requirePoster(taskId);
        require(bytes(scope).length > 0, "TaskScope: empty scope");
        require(bytes(scope).length <= MAX_SCOPE_BYTES, "TaskScope: scope too long");

        _scopes[taskId] = scope;
        emit TaskScopeSet(taskId, msg.sender, keccak256(bytes(scope)));
    }

    /// @inheritdoc ITaskScopeRegistry
    function scopeOf(uint256 taskId) external view override returns (string memory) {
        require(_taskExists(taskId), "TaskScope: unknown task");
        return _scopes[taskId];
    }

    function _taskExists(uint256 taskId) internal view returns (bool) {
        return taskId > 0 && taskId <= ITaskRegistry(taskRegistry).taskCount();
    }

    function _requirePoster(uint256 taskId) internal view {
        require(_taskExists(taskId), "TaskScope: unknown task");
        require(
            ITaskRegistry(taskRegistry).getTask(taskId).poster == msg.sender,
            "TaskScope: not poster"
        );
    }
}

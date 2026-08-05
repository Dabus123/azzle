// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @notice Two-step ownership with explicit cancellation semantics for V2 governance.
/// @dev All V2 `configure*` hooks are one-shot; renounce is disabled so bootstrap cannot be skipped accidentally.
abstract contract V2Ownable2Step is Ownable2Step {
    event OwnershipTransferCancelled(address indexed pendingOwner);

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @dev V2 modules have mandatory post-deployment bootstrap actions.
    ///      Renouncing ownership before those actions would permanently brick them.
    function renounceOwnership() public pure override {
        revert("V2: renounce disabled");
    }

    function cancelOwnershipTransfer() external onlyOwner {
        address proposed = pendingOwner();
        super.transferOwnership(address(0));
        if (proposed != address(0)) emit OwnershipTransferCancelled(proposed);
    }
}
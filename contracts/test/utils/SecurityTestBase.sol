// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AzzleDeployer} from "../fizz/AzzleDeployer.sol";

abstract contract SecurityTestBase is Test {
    AzzleDeployer.Stack internal stack;
    address internal poster;
    address internal buyback;

    function setUp() public virtual {
        poster = makeAddr("poster");
        buyback = makeAddr("buyback");
        stack = (new AzzleDeployer()).deploy(poster, buyback, address(this));
    }

    function assertCoreGraphWired() internal view {
        assertEq(address(stack.taskRegistry.escrow()), address(stack.escrow));
        assertEq(address(stack.taskRegistry.arbitration()), address(stack.arbitration));
        assertEq(address(stack.taskRegistry.agentVault()), address(stack.agentVault));
        assertEq(address(stack.taskRegistry.reputation()), address(stack.reputation));
        assertEq(stack.escrow.arbitrationModule(), address(stack.arbitration));
        assertEq(stack.agentVault.arbitrationModule(), address(stack.arbitration));
        assertEq(address(stack.treasury.stakingVault()), address(stack.staking));
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SecurityTestBase} from "../utils/SecurityTestBase.sol";

contract FullGraphFixtureTest is SecurityTestBase {
    function test_fullGraphFixture_wiresAllCoreContracts() public {
        assertCoreGraphWired();
        assertTrue(address(stack.arbitrationSatellite).code.length > 0);
        assertTrue(address(stack.recovery).code.length > 0);
        assertEq(stack.staking.taskRegistry(), address(stack.taskRegistry));
        assertEq(stack.staking.treasury(), address(stack.treasury));
    }
}

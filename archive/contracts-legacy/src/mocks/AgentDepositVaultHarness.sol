// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AgentDepositVault} from "../AgentDepositVault.sol";

/// @dev Test-only harness — exposes ledger manipulation for pause/deposit tests
contract AgentDepositVaultHarness is AgentDepositVault {
    constructor(address _usdcToken) AgentDepositVault(_usdcToken) {}

    function testSetDeposit(address agent, uint256 amount) external {
        deposits[agent] = amount;
    }
}

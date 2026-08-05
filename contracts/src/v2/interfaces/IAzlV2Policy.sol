// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAzlV2Policy {
    struct TaskQuote {
        uint256 entryDeposit;
        uint256 liveTaskReserve;
        uint256 accessFee;
        uint256 exitCompensation;
        uint256 exitProtocolShare;
    }

    function quoteTask() external view returns (TaskQuote memory);
    function entryDepositAzl() external view returns (uint256);
    function liveTaskReserveAzl() external view returns (uint256);
    function accessFeeAzl() external view returns (uint256);
    function exitCompensationAzl() external view returns (uint256);
    function exitProtocolShareAzl() external view returns (uint256);
}

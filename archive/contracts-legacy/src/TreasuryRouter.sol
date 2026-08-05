// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {AgentDepositVault} from "./AgentDepositVault.sol";

/// @title Protocol fee routing — immutable treasury sink
contract TreasuryRouter is Ownable2Step {
    using SafeERC20 for IERC20;

    address public immutable taskRegistry;

    address public agentDepositVault;
    address public reputationRegistry;
    address public feeRecipient;

    uint16 public protocolFeeBps = 100;

    IERC20 public usdc;
    IERC20 public azlToken;

    uint256 public constant ACCESS_FEE = 5_000_000;
    uint256 public constant AZL_ACCESS_FEE = 1_000 * 1e18;
    uint256 public constant EXIT_PARTY_COMP = 2_500_000;
    uint256 public constant EXIT_PROTOCOL_SHARE = 2_500_000;

    enum AccessFeeKind {
        POST,
        CLAIM,
        DISMISS_SEARCH,
        WORKER_LEAVE
    }

    mapping(address => uint256) public accruedFees;
    uint256 public accruedNative;

    event FeeCollected(address indexed token, uint256 amount);
    event NativeFeeCollected(uint256 amount);
    event AccessFeeCollected(
        AccessFeeKind indexed kind,
        address indexed payer,
        address indexed token,
        uint256 amount
    );
    event ExitCompensationPaid(address indexed token, address indexed recipient, uint256 amount);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    modifier onlyFeeRecorder() {
        require(
            msg.sender == taskRegistry ||
                (agentDepositVault != address(0) && msg.sender == agentDepositVault),
            "Treasury: not recorder"
        );
        _;
    }

    constructor(address _taskRegistry, address _feeRecipient) Ownable(msg.sender) {
        require(_taskRegistry != address(0), "Treasury: zero registry");
        require(_feeRecipient != address(0), "Treasury: zero recipient");
        taskRegistry = _taskRegistry;
        feeRecipient = _feeRecipient;
        require(
            EXIT_PARTY_COMP + EXIT_PROTOCOL_SHARE == ACCESS_FEE,
            "Treasury: exit fee invariant broken"
        );
    }

    function setAgentDepositVault(address _vault) external onlyOwner {
        require(agentDepositVault == address(0), "Treasury: vault set");
        require(_vault != address(0), "Treasury: zero");
        agentDepositVault = _vault;
        usdc = IERC20(AgentDepositVault(_vault).usdcToken());
    }

    function setAzlToken(address token) external onlyOwner {
        require(address(azlToken) == address(0), "Treasury: azl set");
        require(token != address(0), "Treasury: zero");
        azlToken = IERC20(token);
    }

    function setReputationRegistry(address _reputation) external onlyOwner {
        require(reputationRegistry == address(0), "Treasury: reputation set");
        require(_reputation != address(0), "Treasury: zero");
        reputationRegistry = _reputation;
    }

    function _collectDualFee(address from) internal {
        require(address(usdc) != address(0), "Treasury: usdc not set");
        usdc.safeTransferFrom(from, address(this), ACCESS_FEE);
        _collectAzlAccessFee(from);
    }

    function _collectAzlAccessFee(address from) internal {
        require(address(azlToken) != address(0), "Treasury: azl not set");
        azlToken.safeTransferFrom(from, address(this), AZL_ACCESS_FEE);
    }

    function collectAzlAccessFee(address payer, AccessFeeKind kind) external onlyFeeRecorder {
        _collectAzlAccessFee(payer);
        _recordAccessFee(address(azlToken), AZL_ACCESS_FEE, kind, payer);
    }

    function recordAccessFee(
        address token,
        uint256 amount,
        AccessFeeKind kind,
        address payer
    ) external onlyFeeRecorder {
        _recordAccessFee(token, amount, kind, payer);
    }

    function _recordAccessFee(
        address token,
        uint256 amount,
        AccessFeeKind kind,
        address payer
    ) internal {
        accruedFees[token] += amount;
        emit AccessFeeCollected(kind, payer, token, amount);
    }

    function collectFee(address token, address payer, uint256 grossAmount) external returns (uint256 netAmount) {
        require(msg.sender == taskRegistry, "Treasury: not registry");
        require(payer != address(0), "Treasury: zero payer");
        uint256 fee = (grossAmount * protocolFeeBps) / 10000;
        netAmount = grossAmount - fee;
        if (fee > 0) {
            accruedFees[token] += fee;
            IERC20(token).safeTransferFrom(payer, address(this), fee);
            emit FeeCollected(token, fee);
        }
    }

    function recordNativeSlash() external payable {
        require(msg.sender == reputationRegistry, "Treasury: not reputation");
        accruedNative += msg.value;
        emit NativeFeeCollected(msg.value);
    }

    function withdrawFees(address token, address to) external {
        require(msg.sender == feeRecipient, "Treasury: not recipient");
        require(to != address(0), "Treasury: zero to");
        uint256 amount = accruedFees[token];
        require(amount > 0, "Treasury: nothing to withdraw");
        accruedFees[token] = 0;
        IERC20(token).safeTransfer(to, amount);
    }

    function withdrawNativeFees(address to) external {
        require(msg.sender == feeRecipient, "Treasury: not recipient");
        require(to != address(0), "Treasury: zero to");
        uint256 amount = accruedNative;
        require(amount > 0, "Treasury: nothing to withdraw");
        accruedNative = 0;
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "Treasury: native transfer failed");
    }

    function setFeeRecipient(address _recipient) external {
        require(msg.sender == feeRecipient, "Treasury: not recipient");
        require(_recipient != address(0), "Treasury: zero recipient");
        emit FeeRecipientUpdated(feeRecipient, _recipient);
        feeRecipient = _recipient;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IOwnedV2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function transferOwnership(address newOwner) external;
    function cancelOwnershipTransfer() external;
}
interface IObserverV2 {
    function poolManager() external view returns (address);
    function poolId() external view returns (bytes32);
    function twapWindow() external view returns (uint32);
    function maxObservationGap() external view returns (uint32);
}
interface ITwapAdapterV2 {
    function observationOracle() external view returns (address);
    function poolManager() external view returns (address);
    function poolId() external view returns (bytes32);
    function minimumActiveLiquidity() external view returns (uint128);
}
interface IUsdOracleGraphV2 {
    function azlEthTwap() external view returns (address);
    function ethUsdFeed() external view returns (address);
    function sequencerUptimeFeed() external view returns (address);
    function maxFeedAge() external view returns (uint256);
}
interface IPricingPolicyGraphV2 { function oracle() external view returns (address); }
interface IFirstLegV2 {
    function usdc() external view returns (address);
    function weth() external view returns (address);
    function UNIVERSAL_ROUTER() external view returns (address);
    function PERMIT2() external view returns (address);
    function V3_FACTORY() external view returns (address);
    function V3_POOL() external view returns (address);
}
interface IExecutorGraphV2 {
    function usdc() external view returns (address);
    function weth() external view returns (address);
    function azl() external view returns (address);
    function usdcWethLeg() external view returns (address);
    function ethUsdReference() external view returns (address);
    function creditContext() external view returns (bytes32);
    function maxExecutionDeviationBps() external view returns (uint16);
    function gateway() external view returns (address);
    function configurator() external view returns (address);
    function configureGateway(address gateway) external;
}
interface IGatewayGraphV2 {
    function usdc() external view returns (address);
    function azl() external view returns (address);
    function oracle() external view returns (address);
    function executor() external view returns (address);
    function custodyVault() external view returns (address);
    function intakePaused() external view returns (bool);
    function setIntakePaused(bool paused) external;
}
interface IDepositGraphV2 {
    function azl() external view returns (address);
    function policy() external view returns (address);
    function gateway() external view returns (address);
    function registry() external view returns (address);
    function arbitration() external view returns (address);
    function treasury() external view returns (address);
    function configure(address gateway, address registry, address arbitration, address treasury) external;
    function validateGraph() external view returns (bool);
}
interface IEscrowGraphV2 {
    function azl() external view returns (address);
    function registry() external view returns (address);
    function arbitration() external view returns (address);
    function configure(address registry, address arbitration) external;
    function validateGraph() external view returns (bool);
}
interface ITreasuryGraphV2 {
    function azl() external view returns (address);
    function vault() external view returns (address);
    function staking() external view returns (address);
    function bondVault() external view returns (address);
    function burnRecipient() external view returns (address);
    function configure(address vault, address staking) external;
    function configureBondVault(address bondVault) external;
    function validateGraph() external view returns (bool);
}
interface IStakingGraphV2 {
    function azl() external view returns (address);
    function treasury() external view returns (address);
    function registry() external view returns (address);
    function rewardDuration() external view returns (uint256);
    function setTreasury(address treasury) external;
    function setRegistry(address registry) external;
    function validateGraph() external view returns (bool);
}
interface IRegistryGraphV2 {
    function deposits() external view returns (address);
    function escrow() external view returns (address);
    function arbitration() external view returns (address);
    function reputation() external view returns (address);
    function usdOracle() external view returns (address);
    function staking() external view returns (address);
    function openTaskCapUsd6() external view returns (uint256);
    function scopeRegistry() external view returns (address);
    function configureArbitration(address arbitration) external;
    function configureStaking(address staking) external;
    function configureScopeRegistry(address scopeRegistry) external;
    function validateGraph() external view returns (bool);
}
interface ITaskScopeGraphV2 { function taskRegistry() external view returns (address); }
interface IArbitrationGraphV2 {
    function registry() external view returns (address);
    function escrow() external view returns (address);
    function reputation() external view returns (address);
    function bonds() external view returns (address);
    function treasury() external view returns (address);
    function evidenceWindow() external view returns (uint64);
    function rulingWindow() external view returns (uint64);
    function slashCapBps() external view returns (uint16);
    function panelLength() external view returns (uint256);
    function panelMember(uint256 index) external view returns (address);
    function validateGraph() external view returns (bool);
}
interface IReputationGraphV2 {
    function registry() external view returns (address);
    function arbitration() external view returns (address);
    function configure(address registry, address arbitration) external;
    function validateGraph() external view returns (bool);
}
interface IBondGraphV2 {
    function azl() external view returns (address);
    function arbitration() external view returns (address);
    function treasury() external view returns (address);
    function minimumBond() external view returns (uint256);
    function assignmentReserve() external view returns (uint256);
    function isEligible(address verifier) external view returns (bool);
    function configureArbitration(address arbitration) external;
    function configureScopeRegistry(address scopeRegistry) external;
}
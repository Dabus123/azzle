// SPDX-License-Identifier: MIT

//########################################################################################
//########################################################################################
//########################################################################################
//########################################################################################
//########################################.      .########################################
//######################################-          .######################################
//#####################################.            .#####################################
//###############################.+###.              .####-.##############################
//##############################.  ##.                .##-  -#############################
//################################+#.                  .####-#############################
//############################-####.                    .-################################
//##########################-#####.                     .######-##########################
//###############################.          .##-       .+ .######+-#######################
//######################   #####.           ####+     --   .#####   ######################
//##########################+##.          .######- .--      .##+##########################
//############################.           #######+.          .############################
//#############444###########.          .#######.##-          .###########111#############
//##########################.          .#######-####-          .##########################
//#########################.          .-.###.   -##+.-          .#########################
//########################.          .#####.     ######          .########################
//#######################.          .######-    .#######          .#######################
//######################-          .#############+#######          .######################
//#####################.          .######+################          .#####################
//####################-          .#####-############+######          .####################
//###################.          .#####################-#####          .###################
//##################-          .##.  .################-  .###          .##################
//##################         .######+###################+#####.         #GENTIC#LABOR#####
//########################################################################################
//#################AZZLE.ORG##############################################################
//#################SMART#CONTRACT#SUITE###################################################
//##########################. .. .########################################################
//##################..-##..#####. ########################################################
//###################..#. #####. #########################################################
//####################   ####. .##########################################################
//#####################.+###......########################################################
//########################################################################################
//########################################################################################

pragma solidity ^0.8.24;

import {
    IOwnedV2,
    IObserverV2,
    ITwapAdapterV2,
    IUsdOracleGraphV2,
    IPricingPolicyGraphV2,
    IFirstLegV2,
    IExecutorGraphV2,
    IGatewayGraphV2,
    IDepositGraphV2,
    IEscrowGraphV2,
    ITreasuryGraphV2,
    IStakingGraphV2,
    IRegistryGraphV2,
    ITaskScopeGraphV2,
    IArbitrationGraphV2,
    IReputationGraphV2,
    IBondGraphV2
} from "./interfaces/IAzzleSuiteV2Graph.sol";
import {V4PoolKey} from "./V4PoolKey.sol";
import {AzlV4ObservationOracle} from "./AzlV4ObservationOracle.sol";
import {AzlEthTwapAdapter} from "./AzlEthTwapAdapter.sol";
import {AzlUsdOracle} from "./AzlUsdOracle.sol";
import {AzlPricingPolicy} from "./AzlPricingPolicy.sol";
import {AgentDepositVaultV2} from "./AgentDepositVaultV2.sol";
import {EscrowVaultV2} from "./EscrowVaultV2.sol";
import {ReputationRegistryV2} from "./ReputationRegistryV2.sol";
import {VerifierBondVaultV2} from "./VerifierBondVaultV2.sol";
import {UnionStakingVaultV2} from "./UnionStakingVaultV2.sol";
import {TreasuryRouterV2} from "./TreasuryRouterV2.sol";
import {TaskRegistryV2} from "./TaskRegistryV2.sol";
import {ArbitrationModuleV2} from "./ArbitrationModuleV2.sol";
import {BaseUsdcWethExactInputLeg} from "./BaseUsdcWethExactInputLeg.sol";
import {BaseAzlExactInputExecutor} from "./BaseAzlExactInputExecutor.sol";
import {AzlPaymentGateway} from "./AzlPaymentGateway.sol";

/// @notice Committed, phased CREATE2 deployer and graph validator for the Base AZL-only V2 suite.
/// @dev The release script commits the complete ordered bundle before any component is deployed.
///      Deployment is split into bounded batches to fit Base transaction gas limits; final wiring
///      and ownership proposals remain unavailable until all components and panel collateral exist.
contract AzzleSuiteV2Factory {
    using V4PoolKey for V4PoolKey.PoolKey;

    address public constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant BASE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant BASE_AZL = 0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3;
    address public constant BASE_POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;
    address public constant BASE_UNIVERSAL_ROUTER = 0x6fF5693b99212Da76ad316178A184AB56D299b43;
    address public constant BASE_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address public constant BASE_V3_FACTORY = 0x33128a8fC17869897dcE68Ed026d694621f6FDfD;
    address public constant BASE_USDC_WETH_POOL = 0xd0b53D9277642d899DF5C87A3966A349A798F224;
    address public constant BASE_AZL_WETH_HOOK = 0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544;
    address public constant BASE_ETH_USD_FEED = 0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70;
    address public constant BASE_SEQUENCER_UPTIME_FEED = 0xBCF85224fc0756B9Fa45aA7892530B47e10b6433;
    bytes32 public constant BASE_AZL_WETH_POOL_ID =
        0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad;
    uint256 public constant REQUIRED_OPEN_TASK_CAP_USD6 = 10_000_000_000;
    uint256 public constant REQUIRED_MINIMUM_VERIFIER_BOND_AZL = 10_000 ether;
    bytes32 public constant REQUIRED_CREDIT_CONTEXT = keccak256("AZZLE_V2_AGENT_DEPOSIT");
    uint32 public constant REQUIRED_TWAP_WINDOW = 2 hours;
    uint32 public constant REQUIRED_MAX_OBSERVATION_GAP = 15 minutes;
    uint128 public constant REQUIRED_MINIMUM_ACTIVE_LIQUIDITY = 500_000_000_000_000_000_000_000;
    uint256 public constant REQUIRED_MAX_FEED_AGE = 1 hours;
    uint256 public constant REQUIRED_STAKING_REWARD_DURATION = 7 days;
    uint64 public constant REQUIRED_EVIDENCE_WINDOW = 3 days;
    uint64 public constant REQUIRED_RULING_WINDOW = 2 days;
    uint16 public constant REQUIRED_SLASH_CAP_BPS = 1_000;
    uint16 public constant REQUIRED_MAX_EXECUTION_DEVIATION_BPS = 500;
    uint64 public constant BUNDLE_STAGE_DELAY = 15 minutes;
    /// @dev Accepted Risk (deliberate trade-off): an expired, never-finalized bundle has no on-chain reset
    ///      path — stageBundle() will permanently reject re-staging once stagedBundleHash is set. This is
    ///      intentional: a silent "reset and retry" path would undermine the commit-then-delay guarantee
    ///      this staging mechanism exists to provide. Recovery requires a fresh factory deployment, which
    ///      is judged acceptable given this only affects the one-time bootstrap phase, not steady-state operation.
    uint64 public constant BUNDLE_STAGE_EXPIRY = 7 days;
    uint256 internal constant COMPONENT_COUNT = 16;
    uint8 public constant BATCH_A = 0;
    uint8 public constant BATCH_B = 1;
    uint8 public constant BATCH_C = 2;
    uint8 public constant FINALIZED_PHASE = 3;
    address public immutable releaseAuthority;
    bytes32 public stagedBundleHash;
    uint64 public stagedBundleValidAfter;
    uint64 public stagedBundleExpiresAt;
    /// @notice Number of completed deployment batches; 3 after all components, 4 after finalization.
    uint8 public deploymentPhase;
    bool public suiteDeployed;
    address public governance;
    address[COMPONENT_COUNT] private _components;
    Deployment internal _deployedSuite;
    bytes32[COMPONENT_COUNT] internal _stagedInitCodeHashes;
    bytes32[COMPONENT_COUNT] internal _stagedSalts;
    RiskConfig internal _stagedConfig;

    struct RiskConfig {
        address governance;
        address burnRecipient;
        uint256 minimumVerifierBondAzl;
        uint256 stakingRewardDuration;
        uint256 maxFeedAge;
        uint32 twapWindow;
        uint32 maxObservationGap;
        uint128 minimumActiveLiquidity;
        uint64 evidenceWindow;
        uint64 rulingWindow;
        uint16 slashCapBps;
        uint16 maxExecutionDeviationBps;
        bytes32 creditContext;
    }

    struct Deployment {
        address observationOracle;
        address twapAdapter;
        address usdOracle;
        address pricingPolicy;
        address depositVault;
        address escrowVault;
        address reputationRegistry;
        address verifierBondVault;
        address stakingVault;
        address treasuryRouter;
        address taskRegistry;
        address arbitrationModule;
        address usdcWethLeg;
        address exactInputExecutor;
        address paymentGateway;
        address taskScopeRegistry;
    }

    event BundleStaged(bytes32 indexed bundleHash, uint64 validAfter, uint64 expiresAt);
    event DeploymentBatchCompleted(uint8 indexed batch, uint256 indexed firstComponent, uint256 lastComponent);
    event SuiteDeployed(bytes32 indexed manifestHash, address indexed governance, Deployment deployment);
    event OwnershipReproposed(address indexed module, address indexed governance);

    constructor() { releaseAuthority = msg.sender; }

    function deploymentComponentCount() external pure returns (uint256) { return COMPONENT_COUNT; }
    error InvalidProductionEnvironment();
    error InvalidConfiguration();
    error DeploymentFailed(uint256 component);
    error GraphMismatch();
    error Unauthorized();
    error SuiteAlreadyDeployed();
    error BundleNotStaged();
    error BundleNotMature();
    error BundleExpired();
    error BundleHashMismatch();
    error InvalidDeploymentPhase(uint8 expected, uint8 actual);
    error ComponentAlreadyDeployed(uint256 component);

    function productionPoolKey() public pure returns (V4PoolKey.PoolKey memory) {
        return V4PoolKey.PoolKey(BASE_WETH, BASE_AZL, 0x800000, 200, BASE_AZL_WETH_HOOK);
    }

    function validateProductionConstants() public view returns (bool) {
        return block.chainid == 8453 && productionPoolKey().toId() == BASE_AZL_WETH_POOL_ID
            && BASE_USDC.code.length != 0 && BASE_WETH.code.length != 0 && BASE_AZL.code.length != 0
            && BASE_POOL_MANAGER.code.length != 0 && BASE_UNIVERSAL_ROUTER.code.length != 0
            && BASE_PERMIT2.code.length != 0 && BASE_V3_FACTORY.code.length != 0
            && BASE_USDC_WETH_POOL.code.length != 0 && BASE_AZL_WETH_HOOK.code.length != 0
            && BASE_ETH_USD_FEED.code.length != 0;
    }

    function bundleHash(bytes32[] calldata initCodeHashes, bytes32[] calldata salts, RiskConfig calldata config)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(initCodeHashes, salts, config));
    }

    /// @notice Commits init-code hashes, salts, and production configuration for phased CREATE2 deployment.
    /// @dev Full creation bytecode is supplied only per batch at deploy time, keeping each Base tx under
    ///      the 128 KiB calldata limit while preserving hash-for-hash bundle integrity.
    function stageBundle(bytes32[] calldata initCodeHashes, bytes32[] calldata salts, RiskConfig calldata config)
        external
    {
        if (msg.sender != releaseAuthority) revert Unauthorized();
        if (suiteDeployed || deploymentPhase != 0) revert SuiteAlreadyDeployed();
        if (stagedBundleHash != bytes32(0)) revert BundleNotStaged();
        if (initCodeHashes.length != COMPONENT_COUNT || salts.length != COMPONENT_COUNT) revert InvalidConfiguration();
        _validateRiskConfig(config);
        bytes32 committedBundleHash = bundleHash(initCodeHashes, salts, config);
        if (committedBundleHash == bytes32(0)) revert InvalidConfiguration();
        for (uint256 i; i < COMPONENT_COUNT; ++i) {
            if (initCodeHashes[i] == bytes32(0)) revert InvalidConfiguration();
            _stagedInitCodeHashes[i] = initCodeHashes[i];
            _stagedSalts[i] = salts[i];
        }
        _stagedConfig = config;
        uint64 validAfter = uint64(block.timestamp) + BUNDLE_STAGE_DELAY;
        uint64 expiresAt = validAfter + BUNDLE_STAGE_EXPIRY;
        stagedBundleHash = committedBundleHash;
        stagedBundleValidAfter = validAfter;
        stagedBundleExpiresAt = expiresAt;
        emit BundleStaged(committedBundleHash, validAfter, expiresAt);
    }

    /// @notice Deploys one fixed component batch from the committed exact bundle.
    /// @param batch 0 deploys [0..5], 1 deploys [6..10], and 2 deploys [11..15].
    /// @dev Only the batch slice of init codes is supplied; each entry must match the staged hash.
    function deployBatch(bytes[] calldata initCodes, uint8 batch) external {
        if (msg.sender != releaseAuthority) revert Unauthorized();
        _validateStagedBundleActive();
        if (!validateProductionConstants()) revert InvalidProductionEnvironment();
        if (batch != deploymentPhase || batch > BATCH_C) revert InvalidDeploymentPhase(deploymentPhase, batch);

        uint256 first;
        uint256 last;
        if (batch == BATCH_A) {
            first = 0;
            last = 5;
        } else if (batch == BATCH_B) {
            first = 6;
            last = 10;
        } else {
            first = 11;
            last = 15;
        }
        if (initCodes.length != last - first + 1) revert InvalidConfiguration();
        for (uint256 i = first; i <= last; ++i) {
            if (_components[i] != address(0)) revert ComponentAlreadyDeployed(i);
            bytes calldata code = initCodes[i - first];
            if (code.length == 0 || keccak256(code) != _stagedInitCodeHashes[i]) revert BundleHashMismatch();
            bytes32 salt = _stagedSalts[i];
            address deployed = _deploy(code, salt, i);
            address expected = address(uint160(uint256(keccak256(
                abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(code))
            ))));
            if (deployed != expected) revert DeploymentFailed(i);
            _components[i] = deployed;
        }
        deploymentPhase = batch + 1;
        emit DeploymentBatchCompleted(batch, first, last);
    }

    /// @notice Wires a fully deployed committed suite and proposes fixed governance ownership.
    /// @dev This is deliberately separate from deployment so verifiers can bond after batch B.
    function finalize() external returns (Deployment memory deployment) {
        if (msg.sender != releaseAuthority) revert Unauthorized();
        _validateStagedBundleActive();
        if (!validateProductionConstants()) revert InvalidProductionEnvironment();
        RiskConfig memory config = _stagedConfig;
        _validateRiskConfig(config);
        if (deploymentPhase != FINALIZED_PHASE) revert InvalidDeploymentPhase(FINALIZED_PHASE, deploymentPhase);

        address[COMPONENT_COUNT] memory components = _components;
        deployment = _asDeployment(components);
        IExecutorGraphV2(deployment.exactInputExecutor).configureGateway(deployment.paymentGateway);
        IRegistryGraphV2(deployment.taskRegistry).configureArbitration(deployment.arbitrationModule);
        IRegistryGraphV2(deployment.taskRegistry).configureScopeRegistry(deployment.taskScopeRegistry);
        IDepositGraphV2(deployment.depositVault).configure(
            deployment.paymentGateway, deployment.taskRegistry, deployment.arbitrationModule, deployment.treasuryRouter
        );
        IEscrowGraphV2(deployment.escrowVault).configure(deployment.taskRegistry, deployment.arbitrationModule);
        IReputationGraphV2(deployment.reputationRegistry).configure(deployment.taskRegistry, deployment.arbitrationModule);
        IBondGraphV2(deployment.verifierBondVault).configureArbitration(deployment.arbitrationModule);
        IStakingGraphV2(deployment.stakingVault).setTreasury(deployment.treasuryRouter);
        IStakingGraphV2(deployment.stakingVault).setRegistry(deployment.taskRegistry);
        IRegistryGraphV2(deployment.taskRegistry).configureStaking(deployment.stakingVault);
        ITreasuryGraphV2(deployment.treasuryRouter).configure(deployment.depositVault, deployment.stakingVault);
        ITreasuryGraphV2(deployment.treasuryRouter).configureBondVault(deployment.verifierBondVault);

        _validateGraph(deployment, config);
        _validateInitialPanel(deployment);
        governance = config.governance;
        _deployedSuite = deployment;
        _proposeOwnership(deployment, config.governance);
        suiteDeployed = true;
        deploymentPhase = FINALIZED_PHASE + 1;
        delete stagedBundleHash;
        delete stagedBundleValidAfter;
        delete stagedBundleExpiresAt;
        for (uint256 i; i < COMPONENT_COUNT; ++i) {
            delete _stagedInitCodeHashes[i];
            delete _stagedSalts[i];
        }
        delete _stagedConfig;

        bytes32 manifestHash = keccak256(abi.encode(block.chainid, address(this), deployment, config));
        emit SuiteDeployed(manifestHash, config.governance, deployment);
    }


    function deployedSuite() external view returns (Deployment memory) {
        return _deployedSuite;
    }

    function deployedComponent(uint256 index) external view returns (address) {
        if (index >= COMPONENT_COUNT) revert InvalidConfiguration();
        return _components[index];
    }

    /// @notice Re-proposes only factory-owned modules to the governance fixed at deployment.
    function reproposeOwnership() external {
        if (!suiteDeployed) revert BundleNotStaged();
        Deployment memory d = _deployedSuite;
        address target = governance;
        address[10] memory owned = _ownedModules(d);
        for (uint256 i; i < owned.length; ++i) {
            IOwnedV2 module = IOwnedV2(owned[i]);
            if (module.owner() != address(this)) continue;
            if (module.pendingOwner() != address(0)) module.cancelOwnershipTransfer();
            module.transferOwnership(target);
            if (module.owner() != address(this) || module.pendingOwner() != target) revert GraphMismatch();
            emit OwnershipReproposed(owned[i], target);
        }
    }

    function predict(bytes32 salt, bytes32 initCodeHash) external view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }

    function _validateStagedBundleActive() internal view {
        if (suiteDeployed) revert SuiteAlreadyDeployed();
        if (stagedBundleHash == bytes32(0)) revert BundleNotStaged();
        if (block.timestamp < stagedBundleValidAfter) revert BundleNotMature();
        if (block.timestamp > stagedBundleExpiresAt) revert BundleExpired();
    }

    function _validateRiskConfig(RiskConfig memory c) private pure {
        if (
            c.governance == address(0) || c.burnRecipient == address(0)
                || c.minimumVerifierBondAzl != REQUIRED_MINIMUM_VERIFIER_BOND_AZL
                || c.stakingRewardDuration != REQUIRED_STAKING_REWARD_DURATION
                || c.maxFeedAge != REQUIRED_MAX_FEED_AGE || c.twapWindow != REQUIRED_TWAP_WINDOW
                || c.maxObservationGap != REQUIRED_MAX_OBSERVATION_GAP
                || c.minimumActiveLiquidity != REQUIRED_MINIMUM_ACTIVE_LIQUIDITY
                || c.evidenceWindow != REQUIRED_EVIDENCE_WINDOW || c.rulingWindow != REQUIRED_RULING_WINDOW
                || c.slashCapBps != REQUIRED_SLASH_CAP_BPS
                || c.maxExecutionDeviationBps != REQUIRED_MAX_EXECUTION_DEVIATION_BPS
                || c.creditContext != REQUIRED_CREDIT_CONTEXT
        ) revert InvalidConfiguration();
    }

    function _deploy(bytes calldata initCode, bytes32 salt, uint256 index) private returns (address deployed) {
        if (initCode.length == 0) revert DeploymentFailed(index);
        bytes memory code = initCode;
        assembly { deployed := create2(0, add(code, 0x20), mload(code), salt) }
        if (deployed == address(0) || deployed.code.length == 0) revert DeploymentFailed(index);
    }
    function _asDeployment(address[COMPONENT_COUNT] memory c) private pure returns (Deployment memory d) {
        d.observationOracle = c[0];
        d.twapAdapter = c[1];
        d.usdOracle = c[2];
        d.pricingPolicy = c[3];
        d.depositVault = c[4];
        d.escrowVault = c[5];
        d.reputationRegistry = c[6];
        d.verifierBondVault = c[7];
        d.stakingVault = c[8];
        d.treasuryRouter = c[9];
        d.taskRegistry = c[10];
        d.arbitrationModule = c[11];
        d.usdcWethLeg = c[12];
        d.exactInputExecutor = c[13];
        d.paymentGateway = c[14];
        d.taskScopeRegistry = c[15];
    }
    function _validateGraph(Deployment memory d, RiskConfig memory c) private view {
        _validateOracle(d, c);
        _validateRoute(d, c);
        _validateCore(d, c);
        _validateArbitration(d, c);
        _validateTreasury(d, c);
    }

    function _validateOracle(Deployment memory d, RiskConfig memory c) private view {
        if (
            IObserverV2(d.observationOracle).poolManager() != BASE_POOL_MANAGER
                || IObserverV2(d.observationOracle).poolId() != BASE_AZL_WETH_POOL_ID
                || IObserverV2(d.observationOracle).twapWindow() != c.twapWindow
                || IObserverV2(d.observationOracle).maxObservationGap() != c.maxObservationGap
                || ITwapAdapterV2(d.twapAdapter).observationOracle() != d.observationOracle
                || ITwapAdapterV2(d.twapAdapter).poolManager() != BASE_POOL_MANAGER
                || ITwapAdapterV2(d.twapAdapter).poolId() != BASE_AZL_WETH_POOL_ID
                || ITwapAdapterV2(d.twapAdapter).minimumActiveLiquidity() != c.minimumActiveLiquidity
                || IUsdOracleGraphV2(d.usdOracle).azlEthTwap() != d.twapAdapter
                || IUsdOracleGraphV2(d.usdOracle).ethUsdFeed() != BASE_ETH_USD_FEED
                || IUsdOracleGraphV2(d.usdOracle).sequencerUptimeFeed() != BASE_SEQUENCER_UPTIME_FEED
                || IUsdOracleGraphV2(d.usdOracle).maxFeedAge() != c.maxFeedAge
                || IPricingPolicyGraphV2(d.pricingPolicy).oracle() != d.usdOracle
        ) revert GraphMismatch();
    }

    function _validateRoute(Deployment memory d, RiskConfig memory c) private view {
        if (
            IFirstLegV2(d.usdcWethLeg).usdc() != BASE_USDC || IFirstLegV2(d.usdcWethLeg).weth() != BASE_WETH
                || IFirstLegV2(d.usdcWethLeg).UNIVERSAL_ROUTER() != BASE_UNIVERSAL_ROUTER
                || IFirstLegV2(d.usdcWethLeg).PERMIT2() != BASE_PERMIT2
                || IFirstLegV2(d.usdcWethLeg).V3_FACTORY() != BASE_V3_FACTORY
                || IFirstLegV2(d.usdcWethLeg).V3_POOL() != BASE_USDC_WETH_POOL
                || IExecutorGraphV2(d.exactInputExecutor).usdc() != BASE_USDC
                || IExecutorGraphV2(d.exactInputExecutor).weth() != BASE_WETH
                || IExecutorGraphV2(d.exactInputExecutor).azl() != BASE_AZL
                || IExecutorGraphV2(d.exactInputExecutor).usdcWethLeg() != d.usdcWethLeg
                || IExecutorGraphV2(d.exactInputExecutor).ethUsdReference() != d.usdOracle
                || IExecutorGraphV2(d.exactInputExecutor).creditContext() != c.creditContext
                || IExecutorGraphV2(d.exactInputExecutor).maxExecutionDeviationBps() != c.maxExecutionDeviationBps
                || IExecutorGraphV2(d.exactInputExecutor).configurator() != address(this)
                || IExecutorGraphV2(d.exactInputExecutor).gateway() != d.paymentGateway
        ) revert GraphMismatch();
    }

    function _validateCore(Deployment memory d, RiskConfig memory) private view {
        if (
            IGatewayGraphV2(d.paymentGateway).usdc() != BASE_USDC || IGatewayGraphV2(d.paymentGateway).azl() != BASE_AZL
                || IGatewayGraphV2(d.paymentGateway).oracle() != d.usdOracle
                || IGatewayGraphV2(d.paymentGateway).executor() != d.exactInputExecutor
                || IGatewayGraphV2(d.paymentGateway).custodyVault() != d.depositVault
                || !IGatewayGraphV2(d.paymentGateway).intakePaused()
                || IDepositGraphV2(d.depositVault).azl() != BASE_AZL
                || IDepositGraphV2(d.depositVault).policy() != d.pricingPolicy
                || IDepositGraphV2(d.depositVault).gateway() != d.paymentGateway
                || IDepositGraphV2(d.depositVault).registry() != d.taskRegistry
                || IDepositGraphV2(d.depositVault).arbitration() != d.arbitrationModule
                || IDepositGraphV2(d.depositVault).treasury() != d.treasuryRouter
        ) revert GraphMismatch();
        if (
            IEscrowGraphV2(d.escrowVault).azl() != BASE_AZL
                || IEscrowGraphV2(d.escrowVault).registry() != d.taskRegistry
                || IEscrowGraphV2(d.escrowVault).arbitration() != d.arbitrationModule
                || IRegistryGraphV2(d.taskRegistry).deposits() != d.depositVault
                || IRegistryGraphV2(d.taskRegistry).escrow() != d.escrowVault
                || IRegistryGraphV2(d.taskRegistry).arbitration() != d.arbitrationModule
                || IRegistryGraphV2(d.taskRegistry).reputation() != d.reputationRegistry
                || IRegistryGraphV2(d.taskRegistry).usdOracle() != d.usdOracle
                || IRegistryGraphV2(d.taskRegistry).staking() != d.stakingVault
                || IRegistryGraphV2(d.taskRegistry).scopeRegistry() != d.taskScopeRegistry
                || ITaskScopeGraphV2(d.taskScopeRegistry).taskRegistry() != d.taskRegistry
                || IRegistryGraphV2(d.taskRegistry).openTaskCapUsd6() != REQUIRED_OPEN_TASK_CAP_USD6
        ) revert GraphMismatch();
    }

    function _validateArbitration(Deployment memory d, RiskConfig memory c) private view {
        if (
            IArbitrationGraphV2(d.arbitrationModule).registry() != d.taskRegistry
                || IArbitrationGraphV2(d.arbitrationModule).escrow() != d.escrowVault
                || IArbitrationGraphV2(d.arbitrationModule).reputation() != d.reputationRegistry
                || IArbitrationGraphV2(d.arbitrationModule).bonds() != d.verifierBondVault
                || IArbitrationGraphV2(d.arbitrationModule).treasury() != d.treasuryRouter
                || IArbitrationGraphV2(d.arbitrationModule).evidenceWindow() != c.evidenceWindow
                || IArbitrationGraphV2(d.arbitrationModule).rulingWindow() != c.rulingWindow
                || IArbitrationGraphV2(d.arbitrationModule).slashCapBps() != c.slashCapBps
                || IArbitrationGraphV2(d.arbitrationModule).panelLength() == 0
                || IReputationGraphV2(d.reputationRegistry).registry() != d.taskRegistry
                || IReputationGraphV2(d.reputationRegistry).arbitration() != d.arbitrationModule
                || IBondGraphV2(d.verifierBondVault).azl() != BASE_AZL
                || IBondGraphV2(d.verifierBondVault).arbitration() != d.arbitrationModule
                || IBondGraphV2(d.verifierBondVault).treasury() != d.treasuryRouter
                || IBondGraphV2(d.verifierBondVault).minimumBond() != c.minimumVerifierBondAzl
                || IBondGraphV2(d.verifierBondVault).assignmentReserve() != c.minimumVerifierBondAzl
        ) revert GraphMismatch();
    }

    function _validateInitialPanel(Deployment memory d) private view {
        uint256 length = IArbitrationGraphV2(d.arbitrationModule).panelLength();
        if (length == 0) revert GraphMismatch();
        for (uint256 i; i < length; ++i) {
            address member = IArbitrationGraphV2(d.arbitrationModule).panelMember(i);
            if (!IBondGraphV2(d.verifierBondVault).isEligible(member)) revert GraphMismatch();
        }
    }

    function _validateTreasury(Deployment memory d, RiskConfig memory c) private view {
        if (
            IStakingGraphV2(d.stakingVault).azl() != BASE_AZL
                || IStakingGraphV2(d.stakingVault).treasury() != d.treasuryRouter
                || IStakingGraphV2(d.stakingVault).registry() != d.taskRegistry
                || IStakingGraphV2(d.stakingVault).rewardDuration() != c.stakingRewardDuration
                || ITreasuryGraphV2(d.treasuryRouter).azl() != BASE_AZL
                || ITreasuryGraphV2(d.treasuryRouter).vault() != d.depositVault
                || ITreasuryGraphV2(d.treasuryRouter).staking() != d.stakingVault
                || ITreasuryGraphV2(d.treasuryRouter).bondVault() != d.verifierBondVault
                || ITreasuryGraphV2(d.treasuryRouter).burnRecipient() != c.burnRecipient
                || !IDepositGraphV2(d.depositVault).validateGraph()
                || !IEscrowGraphV2(d.escrowVault).validateGraph()
                || !ITreasuryGraphV2(d.treasuryRouter).validateGraph()
                || !IStakingGraphV2(d.stakingVault).validateGraph()
                || !IRegistryGraphV2(d.taskRegistry).validateGraph()
                || !IArbitrationGraphV2(d.arbitrationModule).validateGraph()
                || !IReputationGraphV2(d.reputationRegistry).validateGraph()
        ) revert GraphMismatch();
    }

    function _ownedModules(Deployment memory d) private pure returns (address[10] memory) {
        return [d.twapAdapter, d.depositVault, d.escrowVault, d.reputationRegistry, d.verifierBondVault, d.stakingVault, d.treasuryRouter, d.taskRegistry, d.arbitrationModule, d.paymentGateway];
    }

    function _proposeOwnership(Deployment memory d, address targetGovernance) private {
        address[10] memory owned = _ownedModules(d);
        for (uint256 i; i < owned.length; ++i) {
            if (IOwnedV2(owned[i]).owner() != address(this)) revert GraphMismatch();
            IOwnedV2(owned[i]).transferOwnership(targetGovernance);
            if (IOwnedV2(owned[i]).owner() != address(this) || IOwnedV2(owned[i]).pendingOwner() != targetGovernance) revert GraphMismatch();
        }
    }
}
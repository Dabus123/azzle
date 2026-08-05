import hre, { ethers } from "hardhat";

const BASE = {
  azl: ethers.getAddress("0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3"),
  usdc: ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  poolManager: ethers.getAddress("0x498581fF718922c3f8e6A244956aF099B2652b2b"),
  ethUsdFeed: ethers.getAddress("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
  hook: ethers.getAddress("0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544"),
  weth: ethers.getAddress("0x4200000000000000000000000000000000000006"),
} as const;

const poolKey = {
  currency0: BASE.weth,
  currency1: BASE.azl,
  fee: 0x800000,
  tickSpacing: 200,
  hooks: BASE.hook,
};

const COMPONENT_NAMES = [
  "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy", "depositVault",
  "escrowVault", "reputationRegistry", "verifierBondVault", "stakingVault", "treasuryRouter",
  "taskRegistry", "arbitrationModule", "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
] as const;

const DEFAULTS = {
  twapWindow: 2 * 60 * 60,
  maxObservationGap: 15 * 60,
  minimumActiveLiquidity: 500_000_000_000_000_000_000_000n,
  maxFeedAge: 60 * 60,
  stakingRewardDuration: 7 * 24 * 60 * 60,
  evidenceWindow: 3 * 24 * 60 * 60,
  rulingWindow: 2 * 24 * 60 * 60,
  slashCapBps: 1_000,
  maxExecutionDeviationBps: 500,
  minimumVerifierBondAzl: ethers.parseEther("10000"),
  openTaskCapUsd6: 10_000_000_000n,
  creditContext: ethers.id("AZZLE_V2_AGENT_DEPOSIT"),
} as const;

async function initCode(name: string, args: unknown[]): Promise<string> {
  const factory = await ethers.getContractFactory(name);
  const tx = await factory.getDeployTransaction(...args);
  if (!tx.data) throw new Error(`missing init code for ${name}`);
  return tx.data.toString();
}

function parsePanel(): string[] {
  const panel = (process.env.V2_INITIAL_PANEL || "").split(",").map((v) => v.trim()).filter(Boolean);
  return panel.map((v) => ethers.getAddress(v));
}

function decodeRevert(data: string | null | undefined): string {
  if (!data || data === "0x") return "empty revert data";
  const iface = new ethers.Interface([
    "error InvalidProductionEnvironment()",
    "error InvalidConfiguration()",
    "error DeploymentFailed(uint256 component)",
    "error GraphMismatch()",
    "error Unauthorized()",
    "error SuiteAlreadyDeployed()",
    "error BundleNotStaged()",
    "error BundleNotMature()",
    "error BundleExpired()",
    "error BundleHashMismatch()",
    "error InvalidDeploymentPhase(uint8 expected, uint8 actual)",
    "error ComponentAlreadyDeployed(uint256 component)",
  ]);
  try {
    const parsed = iface.parseError(data);
    return parsed ? `${parsed.name}(${parsed.args.map(String).join(", ")})` : data;
  } catch {
    return data;
  }
}

async function main() {
  const factoryAddress = process.env.V2_FACTORY_ADDRESS!.trim();
  const governance = ethers.getAddress(process.env.V2_GOVERNANCE_SAFE!.trim());
  const burnRecipient = ethers.getAddress(process.env.V2_BURN_RECIPIENT!.trim());
  const panel = parsePanel();
  const factory = await ethers.getContractAt("AzzleSuiteV2Factory", factoryAddress);
  const [deployer] = await ethers.getSigners();

  const salts = COMPONENT_NAMES.map((name) => ethers.id(`AZZLE_V2_${name.toUpperCase()}`));
  const predicted: Record<string, string> = {};
  const codes: string[] = [];
  const push = async (name: string, contractName: string, args: unknown[]) => {
    const code = await initCode(contractName, args);
    predicted[name] = ethers.getCreate2Address(factoryAddress, salts[codes.length], ethers.keccak256(code));
    codes.push(code);
  };
  const treasuryInitCode = await initCode("TreasuryRouterV2", [BASE.azl, burnRecipient, factoryAddress]);
  predicted.treasuryRouter = ethers.getCreate2Address(factoryAddress, salts[9], ethers.keccak256(treasuryInitCode));

  await push("observationOracle", "AzlV4ObservationOracle", [BASE.poolManager, poolKey, DEFAULTS.twapWindow, DEFAULTS.maxObservationGap]);
  await push("twapAdapter", "AzlEthTwapAdapter", [predicted.observationOracle, DEFAULTS.minimumActiveLiquidity, factoryAddress]);
  await push("usdOracle", "AzlUsdOracle", [predicted.twapAdapter, BASE.ethUsdFeed, DEFAULTS.maxFeedAge, "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433"]);
  await push("pricingPolicy", "AzlPricingPolicy", [predicted.usdOracle]);
  await push("depositVault", "AgentDepositVaultV2", [BASE.azl, predicted.pricingPolicy, factoryAddress]);
  await push("escrowVault", "EscrowVaultV2", [BASE.azl, factoryAddress]);
  await push("reputationRegistry", "ReputationRegistryV2", [factoryAddress]);
  await push("verifierBondVault", "VerifierBondVaultV2", [BASE.azl, DEFAULTS.minimumVerifierBondAzl, 7 * 24 * 60 * 60, predicted.treasuryRouter, factoryAddress]);
  await push("stakingVault", "UnionStakingVaultV2", [BASE.azl, DEFAULTS.stakingRewardDuration, factoryAddress]);
  await push("treasuryRouter", "TreasuryRouterV2", [BASE.azl, burnRecipient, factoryAddress]);
  await push("taskRegistry", "TaskRegistryV2", [predicted.depositVault, predicted.escrowVault, predicted.reputationRegistry, predicted.usdOracle, DEFAULTS.openTaskCapUsd6, factoryAddress]);
  await push("arbitrationModule", "ArbitrationModuleV2", [predicted.taskRegistry, predicted.escrowVault, predicted.reputationRegistry, predicted.verifierBondVault, predicted.treasuryRouter, DEFAULTS.evidenceWindow, DEFAULTS.rulingWindow, DEFAULTS.slashCapBps, panel, factoryAddress]);
  await push("usdcWethLeg", "BaseUsdcWethExactInputLeg", []);
  await push("exactInputExecutor", "BaseAzlExactInputExecutor", [predicted.usdcWethLeg, predicted.usdOracle, DEFAULTS.creditContext, DEFAULTS.maxExecutionDeviationBps, factoryAddress]);
  await push("paymentGateway", "AzlPaymentGateway", [BASE.usdc, BASE.azl, predicted.usdOracle, predicted.exactInputExecutor, predicted.depositVault, factoryAddress]);
  await push("taskScopeRegistry", "TaskScopeRegistryV2", [predicted.taskRegistry]);

  const config = {
    governance, burnRecipient,
    minimumVerifierBondAzl: DEFAULTS.minimumVerifierBondAzl,
    stakingRewardDuration: DEFAULTS.stakingRewardDuration,
    maxFeedAge: DEFAULTS.maxFeedAge,
    twapWindow: DEFAULTS.twapWindow,
    maxObservationGap: DEFAULTS.maxObservationGap,
    minimumActiveLiquidity: DEFAULTS.minimumActiveLiquidity,
    evidenceWindow: DEFAULTS.evidenceWindow,
    rulingWindow: DEFAULTS.rulingWindow,
    slashCapBps: DEFAULTS.slashCapBps,
    maxExecutionDeviationBps: DEFAULTS.maxExecutionDeviationBps,
    creditContext: DEFAULTS.creditContext,
  };
  const initCodeHashes = codes.map((code) => ethers.keccak256(code));
  const configTupleType =
    "tuple(address governance,address burnRecipient,uint256 minimumVerifierBondAzl,uint256 stakingRewardDuration,uint256 maxFeedAge,uint32 twapWindow,uint32 maxObservationGap,uint128 minimumActiveLiquidity,uint64 evidenceWindow,uint64 rulingWindow,uint16 slashCapBps,uint16 maxExecutionDeviationBps,bytes32 creditContext)";
  const bundleHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32[]", "bytes32[]", configTupleType], [initCodeHashes, salts, config])
  );
  const staged = await factory.stagedBundleHash();
  console.log("local bundleHash", bundleHash);
  console.log("staged bundleHash", staged);
  console.log("bundle match", bundleHash === staged);

  for (let i = 6; i <= 10; i++) {
    const code = codes[i];
    const predictedAddr = Object.values(predicted)[i];
    console.log(
      `[${i}] ${COMPONENT_NAMES[i]} init=${(code.length - 2) / 2}B predicted=${predictedAddr}`
    );
  }

  const batchCodes = codes.slice(6, 11);
  const calldata = factory.interface.encodeFunctionData("deployBatch", [batchCodes, 1]);
  console.log("calldata bytes", calldata.length / 2 - 1);
  console.log("validateProductionConstants", await factory.validateProductionConstants());

  try {
    await factory.deployBatch.staticCall(batchCodes, 1, { from: deployer.address });
    console.log("staticCall: SUCCESS");
  } catch (error: unknown) {
    const err = error as { data?: string; error?: { data?: string }; message?: string };
    const data = err.data ?? err.error?.data;
    console.log("staticCall revert:", decodeRevert(data));
    console.log("raw:", data ?? err.message);
  }

  // Try each component individually via eth_call simulation at factory
  for (let n = 1; n <= 5; n++) {
    const subset = batchCodes.slice(0, n);
    try {
      await factory.deployBatch.staticCall(subset, 1, { from: deployer.address });
      console.log(`subset [6..${5 + n}] staticCall: SUCCESS (unexpected - wrong length)`);
    } catch (error: unknown) {
      const err = error as { data?: string; error?: { data?: string }; message?: string };
      const data = err.data ?? err.error?.data;
      const msg = decodeRevert(data);
      console.log(`subset len=${n} revert: ${msg}`);
    }
  }
}

main().catch(console.error);

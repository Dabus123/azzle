import hre, { ethers, network } from "hardhat";
import canonicalManifest from "../deployments/base-8453.json";
import fs from "node:fs";
import path from "node:path";

const BASE = {
  chainId: 8453n,
  usdc: ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
  weth: ethers.getAddress("0x4200000000000000000000000000000000000006"),
  azl: ethers.getAddress("0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3"),
  poolManager: ethers.getAddress("0x498581fF718922c3f8e6A244956aF099B2652b2b"),
  universalRouter: ethers.getAddress("0x6fF5693b99212Da76ad316178A184AB56D299b43"),
  hook: ethers.getAddress("0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544"),
  ethUsdFeed: ethers.getAddress("0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70"),
  poolId: "0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad",
} as const;

const poolKey = {
  currency0: BASE.weth,
  currency1: BASE.azl,
  fee: 0x800000,
  tickSpacing: 200,
  hooks: BASE.hook,
};

function assertAuthoritativeManifest(): void {
  if (canonicalManifest.chainId !== BASE.chainId.toString()) {
    throw new Error(`canonical V2 manifest chainId is ${canonicalManifest.chainId}, expected 8453`);
  }
  if (ethers.getAddress(canonicalManifest.external.usdc) !== BASE.usdc) {
    throw new Error("authoritative manifest USDC does not match fixed Base USDC");
  }
  if (ethers.getAddress(canonicalManifest.external.azl) !== BASE.azl) {
    throw new Error("authoritative manifest AZL does not match fixed Base AZL");
  }
}

function rejectAddressOverride(name: string, expected: string): void {
  const supplied = process.env[name]?.trim();
  if (supplied && (!ethers.isAddress(supplied) || ethers.getAddress(supplied) !== expected)) {
    throw new Error(`${name} override does not match the fixed production address`);
  }
}

async function requireCode(name: string, address: string): Promise<number> {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") throw new Error(`${name} has no code at ${address}`);
  return (code.length - 2) / 2;
}

async function runStaticPreflight() {
  const current = await ethers.provider.getNetwork();
  if (current.chainId !== BASE.chainId) throw new Error("V2 deployment and preflight are Base-only");

  assertAuthoritativeManifest();
  rejectAddressOverride("USDC_ADDRESS", BASE.usdc);
  rejectAddressOverride("AZL_ADDRESS", BASE.azl);
  rejectAddressOverride("WETH_ADDRESS", BASE.weth);
  rejectAddressOverride("POOL_MANAGER", BASE.poolManager);
  rejectAddressOverride("UNIVERSAL_ROUTER", BASE.universalRouter);
  rejectAddressOverride("AZL_WETH_HOOK", BASE.hook);
  rejectAddressOverride("ETH_USD_FEED", BASE.ethUsdFeed);
  const suppliedPoolId = process.env.AZL_WETH_POOL_ID?.trim().toLowerCase();
  if (suppliedPoolId && suppliedPoolId !== BASE.poolId) {
    throw new Error("AZL_WETH_POOL_ID override does not match the fixed production pool");
  }

  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks]
    )
  );
  if (poolId !== BASE.poolId) throw new Error(`computed PoolKey ID ${poolId} is not the production pool`);

  const codeLengths = Object.fromEntries(
    await Promise.all(
      [
        ["usdc", BASE.usdc],
        ["weth", BASE.weth],
        ["azl", BASE.azl],
        ["poolManager", BASE.poolManager],
        ["universalRouter", BASE.universalRouter],
        ["hook", BASE.hook],
        ["ethUsdFeed", BASE.ethUsdFeed],
      ].map(async ([name, address]) => [name, await requireCode(name, address)] as const)
    )
  );

  const manager = new ethers.Contract(
    BASE.poolManager,
    ["function extsload(bytes32) view returns (bytes32)"],
    ethers.provider
  );
  const poolsSlot = ethers.zeroPadValue(ethers.toBeHex(6), 32);
  const stateSlot = ethers.keccak256(
    ethers.solidityPacked(["bytes32", "bytes32"], [BASE.poolId, poolsSlot])
  );
  const packedSlot0: string = await manager.extsload(stateSlot);
  const slot0Word = BigInt(packedSlot0);
  const sqrtPriceX96 = slot0Word & ((1n << 160n) - 1n);
  const unsignedTick = (slot0Word >> 160n) & ((1n << 24n) - 1n);
  const tick = unsignedTick >= (1n << 23n) ? unsignedTick - (1n << 24n) : unsignedTick;
  const protocolFee = (slot0Word >> 184n) & ((1n << 24n) - 1n);
  const lpFee = (slot0Word >> 208n) & ((1n << 24n) - 1n);
  if (sqrtPriceX96 === 0n) throw new Error("production AZL/WETH PoolManager slot0 is uninitialized");

  const feed = new ethers.Contract(
    BASE.ethUsdFeed,
    [
      "function decimals() view returns (uint8)",
      "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
    ],
    ethers.provider
  );
  const decimals: bigint = await feed.decimals();
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = await feed.latestRoundData();
  if (
    decimals > 18n || roundId === 0n || answer <= 0n || startedAt === 0n ||
    updatedAt === 0n || answeredInRound < roundId
  ) {
    throw new Error("fixed Base ETH/USD feed failed structural validation");
  }

  return {
    network: network.name,
    chainId: current.chainId.toString(),
    poolId,
    poolKey,
    codeLengths,
    slot0: {
      sqrtPriceX96: sqrtPriceX96.toString(),
      tick: tick.toString(),
      protocolFee: protocolFee.toString(),
      lpFee: lpFee.toString(),
    },
    ethUsdFeed: {
      address: BASE.ethUsdFeed,
      decimals: decimals.toString(),
      roundId: roundId.toString(),
      updatedAt: updatedAt.toString(),
    },
  };
}

const COMPONENT_NAMES = [
  "observationOracle", "twapAdapter", "usdOracle", "pricingPolicy", "depositVault",
  "escrowVault", "reputationRegistry", "verifierBondVault", "stakingVault", "treasuryRouter",
  "taskRegistry", "arbitrationModule", "usdcWethLeg", "exactInputExecutor", "paymentGateway", "taskScopeRegistry",
] as const;

const GOVERNANCE_SAFE = ethers.getAddress("0xB459145b74Ca4B198f73C0d573a161e85CA76D27");
const V2_RECEIPT = path.resolve(__dirname, "../deployments/base-8453-v2.candidate.json");
const V2_HANDOFF_ARTIFACT = path.resolve(__dirname, "../deployments/base-8453-v2-handoff-safe.json");
const V2_LAUNCH_ARTIFACT = path.resolve(__dirname, "../deployments/base-8453-v2-launch-safe.json");
type V2CandidateReceipt = {
  version: "2.0.0";
  chainId: "8453";
  factory: string;
  governance: string;
  bundleHash: string;
  arbitrationModule: string;
  risk: {
    burnRecipient: string;
  };
};
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

function requireAddressEnv(name: string, fallback?: string): string {
  const raw = process.env[name]?.trim() || fallback;
  if (!raw || !ethers.isAddress(raw)) throw new Error(`${name} must be an explicit valid address`);
  return ethers.getAddress(raw);
}

function parsePanel(): string[] {
  const panel = (process.env.V2_INITIAL_PANEL || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (panel.length === 0) throw new Error("V2_INITIAL_PANEL must contain at least one bonded verifier address");
  const normalized = panel.map((v) => {
    if (!ethers.isAddress(v)) throw new Error(`invalid V2_INITIAL_PANEL address: ${v}`);
    return ethers.getAddress(v);
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("V2_INITIAL_PANEL contains duplicates");
  return normalized;
}

async function initCode(name: string, args: unknown[]): Promise<string> {
  const factory = await ethers.getContractFactory(name);
  const tx = await factory.getDeployTransaction(...args);
  if (!tx.data) throw new Error(`missing init code for ${name}`);
  return tx.data.toString();
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item)) as T;
}

function decodeFactoryRevert(data: string | null | undefined): string | undefined {
  if (!data || data === "0x") return undefined;
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

async function assertDeployBatch(factory: any, batchCodes: string[], batch: number, from: string): Promise<void> {
  try {
    await factory.deployBatch.staticCall(batchCodes, batch, { from });
  } catch (error: unknown) {
    const err = error as { data?: string; error?: { data?: string }; message?: string };
    const decoded = decodeFactoryRevert(err.data ?? err.error?.data);
    throw new Error(decoded ? `deployBatch simulation reverted: ${decoded}` : (err.message ?? String(error)));
  }
}

function writeExclusiveAtomic(output: string, value: unknown): void {
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing release artifact: ${output}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(jsonSafe(value), null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  fs.renameSync(temporary, output);
}

function requirePhase(): string {
  const phase = process.env.V2_PHASE?.trim().toLowerCase();
  if (!phase) {
    throw new Error("V2_PHASE is required: preflight, stage, deploy-a, deploy-b, bond-check, deploy-c, finalize, verify-deployed, handoff-artifact, launch-artifact, or promote");
  }
  return phase;
}

async function main() {
  const phase = requirePhase();
  const allowedPhases = new Set([
    "preflight", "stage", "deploy-a", "deploy-b", "bond-check", "deploy-c", "finalize",
    "verify-deployed", "handoff-artifact", "launch-artifact", "promote",
  ]);
  if (!allowedPhases.has(phase)) throw new Error(`unsupported V2_PHASE: ${phase}`);

  const report = await runStaticPreflight();
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("no deployer signer configured");
  const candidateForVerification: V2CandidateReceipt | undefined = phase === "verify-deployed"
    ? (() => {
        if (!fs.existsSync(V2_RECEIPT)) throw new Error(`V2 candidate receipt not found: ${V2_RECEIPT}`);
        const candidate = JSON.parse(fs.readFileSync(V2_RECEIPT, "utf8")) as V2CandidateReceipt;
        if (
          candidate.version !== "2.0.0" || candidate.chainId !== "8453"
            || !ethers.isAddress(candidate.factory) || !ethers.isAddress(candidate.governance)
            || !ethers.isAddress(candidate.risk?.burnRecipient) || !ethers.isAddress(candidate.arbitrationModule)
        ) throw new Error("V2 candidate receipt is malformed");
        return candidate;
      })()
    : undefined;
  const governance = candidateForVerification
    ? ethers.getAddress(candidateForVerification.governance)
    : requireAddressEnv("V2_GOVERNANCE_SAFE", GOVERNANCE_SAFE);
  const burnRecipient = candidateForVerification
    ? ethers.getAddress(candidateForVerification.risk.burnRecipient)
    : requireAddressEnv("V2_BURN_RECIPIENT");
  let panel = candidateForVerification ? [] : parsePanel();
  const factoryContractFactory = await ethers.getContractFactory("AzzleSuiteV2Factory");

  let factoryAddress: string;
  let factory: Awaited<ReturnType<typeof ethers.getContractAt>> | undefined;
  const configuredFactory = process.env.V2_FACTORY_ADDRESS?.trim();
  // Staging always deploys a fresh factory. A previous address may refer to an
  // incompatible release factory, and staging must never attach to or mutate it.
  if (phase === "stage") {
    const deployerNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
    factoryAddress = ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce });
  } else if (candidateForVerification) {
    factoryAddress = ethers.getAddress(candidateForVerification.factory);
    if ((await ethers.provider.getCode(factoryAddress)) === "0x") {
      throw new Error("candidate receipt factory has no code");
    }
    factory = await ethers.getContractAt("AzzleSuiteV2Factory", factoryAddress);
  } else if (configuredFactory) {
    if (!ethers.isAddress(configuredFactory)) throw new Error("V2_FACTORY_ADDRESS must be valid");
    factoryAddress = ethers.getAddress(configuredFactory);
    if ((await ethers.provider.getCode(factoryAddress)) === "0x") throw new Error("V2_FACTORY_ADDRESS has no code");
    factory = await ethers.getContractAt("AzzleSuiteV2Factory", factoryAddress);
    if (ethers.getAddress(await factory.releaseAuthority()) !== deployer.address) {
      throw new Error("configured signer is not the factory releaseAuthority");
    }
    try {
      await factory.deploymentPhase();
      await factory.suiteDeployed();
    } catch {
      throw new Error("V2_FACTORY_ADDRESS is not a compatible current phased V2 factory");
    }
  } else {
    if (!["preflight", "stage"].includes(phase)) throw new Error(`${phase} requires V2_FACTORY_ADDRESS`);
    const deployerNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
    factoryAddress = ethers.getCreateAddress({ from: deployer.address, nonce: deployerNonce });
  }
  if (candidateForVerification) {
    const arbitration = new ethers.Contract(
      candidateForVerification.arbitrationModule,
      ["function panelLength() view returns (uint256)", "function panelMember(uint256) view returns (address)"],
      ethers.provider
    );
    const panelLength = Number(await arbitration.panelLength());
    if (panelLength === 0) throw new Error("candidate arbitration module has no panel members");
    panel = await Promise.all(Array.from({ length: panelLength }, (_, index) => arbitration.panelMember(index)));
  }

  const salts = COMPONENT_NAMES.map((name) => ethers.id(`AZZLE_V2_${name.toUpperCase()}`));
  const predicted: Record<string, string> = {};
  const codes: string[] = [];
  const push = async (name: string, contractName: string, args: unknown[]) => {
    const code = await initCode(contractName, args);
    const salt = salts[codes.length];
    predicted[name] = ethers.getCreate2Address(factoryAddress, salt, ethers.keccak256(code));
    codes.push(code);
  };
  const treasuryInitCode = await initCode("TreasuryRouterV2", [BASE.azl, burnRecipient, factoryAddress]);
  predicted.treasuryRouter = ethers.getCreate2Address(
    factoryAddress, salts[9], ethers.keccak256(treasuryInitCode)
  );

  await push("observationOracle", "AzlV4ObservationOracle", [BASE.poolManager, poolKey, DEFAULTS.twapWindow, DEFAULTS.maxObservationGap]);
  await push("twapAdapter", "AzlEthTwapAdapter", [predicted.observationOracle, DEFAULTS.minimumActiveLiquidity, factoryAddress]);
  await push("usdOracle", "AzlUsdOracle", [
    predicted.twapAdapter,
    BASE.ethUsdFeed,
    DEFAULTS.maxFeedAge,
    "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433",
  ]);
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
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32[]", "bytes32[]", configTupleType],
      [initCodeHashes, salts, config]
    )
  );
  const actionCredits = {
    activationRequired: true, creditUnit: "1000000000000000000",
    lifetimeCap: "600000000000000000000000", baseStakeAzl: "100000000000000000000000000",
    issuancePeriodSeconds: 30 * 24 * 60 * 60,
  };
  const reportOut = {
    phase,
    staticPreflight: report, factory: factoryAddress, bundleHash, predicted,
    riskConfig: { ...config, minimumVerifierBondAzl: config.minimumVerifierBondAzl.toString(), minimumActiveLiquidity: config.minimumActiveLiquidity.toString() },
    actionCredits,
  };

  if (phase === "preflight") {
    console.log(JSON.stringify(jsonSafe(reportOut), null, 2));
    return;
  }

  if (phase === "stage") {
    if (!factory) {
      const deployedFactory = await factoryContractFactory.deploy();
      await deployedFactory.waitForDeployment();
      if (await deployedFactory.getAddress() !== factoryAddress) throw new Error("factory address changed after precomputation");
      factory = await ethers.getContractAt("AzzleSuiteV2Factory", factoryAddress);
    }
    // stageBundle itself atomically rejects an already-finalized or already-staged factory.
    // Do not preflight optional getters here: a stale ABI/RPC response must not prevent
    // deployment of an otherwise valid freshly created factory.
    const tx = await factory.stageBundle(initCodeHashes, salts, config);
    const receipt = await tx.wait();
    if (!receipt) throw new Error("bundle staging receipt missing");
    console.log(JSON.stringify(jsonSafe({ ...reportOut, stageTx: tx.hash, validAfter: await factory.stagedBundleValidAfter(), expiresAt: await factory.stagedBundleExpiresAt() }), null, 2));
    return;
  }

  if (!factory) throw new Error("factory unavailable");
  if (await factory.suiteDeployed() && !["verify-deployed", "handoff-artifact", "launch-artifact", "promote"].includes(phase)) {
    throw new Error("factory has already finalized its suite");
  }
  if (phase === "handoff-artifact" || phase === "launch-artifact" || phase === "promote") {
    if (!(await factory.suiteDeployed())) throw new Error(`${phase} requires a finalized V2 suite`);
    if (phase === "promote") {
      const candidate = JSON.parse(fs.readFileSync(V2_RECEIPT, "utf8")) as { factory: string };
      if (candidate.factory.toLowerCase() !== factoryAddress.toLowerCase()) throw new Error("candidate receipt factory mismatch");
      const canonical = path.resolve(__dirname, "../deployments/base-8453-v2.json");
      if (fs.existsSync(canonical)) throw new Error(`refusing to overwrite canonical V2 manifest: ${canonical}`);
      writeExclusiveAtomic(canonical, candidate);
      console.log(`V2 candidate promoted to ${canonical}`);
      return;
    }
    const suite = await factory.deployedSuite();
    const owned = [
      suite.twapAdapter, suite.depositVault, suite.escrowVault, suite.reputationRegistry,
      suite.verifierBondVault, suite.stakingVault, suite.treasuryRouter, suite.taskRegistry,
      suite.arbitrationModule, suite.paymentGateway,
    ];
    if (phase === "handoff-artifact") {
      writeExclusiveAtomic(V2_HANDOFF_ARTIFACT, {
        version: "1.0", chainId: BASE.chainId.toString(),
        meta: { name: "AZZLE V2 ownership acceptance", txBuilderVersion: "1.18.0", createdFromSafeAddress: governance },
        transactions: owned.map((to) => ({ to, value: "0", data: null, contractMethod: { inputs: [], name: "acceptOwnership", payable: false }, contractInputsValues: {} })),
      });
      console.log(`V2 ownership Safe artifact written to ${V2_HANDOFF_ARTIFACT}`);
      return;
    }
    const adapter = await ethers.getContractAt("AzlEthTwapAdapter", suite.twapAdapter);
    const gateway = await ethers.getContractAt("AzlPaymentGateway", suite.paymentGateway);
    const baseArtifact = {
      version: "1.0", chainId: BASE.chainId.toString(),
      meta: { name: "AZZLE V2 oracle activation", txBuilderVersion: "1.18.0", createdFromSafeAddress: governance },
    };
    writeExclusiveAtomic(V2_LAUNCH_ARTIFACT.replace(".json", "-propose.json"), {
      ...baseArtifact,
      meta: { ...baseArtifact.meta, name: "AZZLE V2 oracle reference proposal" },
      prerequisites: ["Accept all ownership transfers.", "Maintain observer samples continuously for at least 2 hours."],
      transactions: [{ to: await adapter.getAddress(), value: "0", data: null, contractMethod: { inputs: [], name: "proposeReference", payable: false }, contractInputsValues: {} }],
    });
    writeExclusiveAtomic(V2_LAUNCH_ARTIFACT.replace(".json", "-activate.json"), {
      ...baseArtifact,
      meta: { ...baseArtifact.meta, name: "AZZLE V2 oracle reference activation" },
      prerequisites: ["The proposal transaction is confirmed.", "At least 24 hours elapsed after proposal.", "Call is expected to pass adapter readiness checks immediately before Safe execution."],
      transactions: [{ to: await adapter.getAddress(), value: "0", data: null, contractMethod: { inputs: [], name: "activateReference", payable: false }, contractInputsValues: {} }],
    });
    writeExclusiveAtomic(V2_LAUNCH_ARTIFACT.replace(".json", "-unpause.json"), {
      ...baseArtifact,
      meta: { ...baseArtifact.meta, name: "AZZLE V2 intake activation" },
      prerequisites: ["Reference activation is confirmed.", "Adapter is ready and graph/manifest checks pass.", "No unresolved launch gate remains."],
      transactions: [{ to: await gateway.getAddress(), value: "0", data: null, contractMethod: { inputs: [{ name: "paused", type: "bool", internalType: "bool" }], name: "setIntakePaused", payable: false }, contractInputsValues: { paused: "false" } }],
    });
    console.log(`V2 phased launch Safe artifacts written beside ${V2_LAUNCH_ARTIFACT}`);
    return;
  }
  if (phase !== "verify-deployed") {
    const stagedHash: string = await factory.stagedBundleHash();
    if (stagedHash !== bundleHash) throw new Error(`staged bundle ${stagedHash} does not match computed bundle ${bundleHash}`);
  } else if (!candidateForVerification || candidateForVerification.bundleHash !== bundleHash) {
    throw new Error(
      "candidate bundle hash does not match the current compiled source and deployed panel; use the exact release source to verify this candidate"
    );
  }
  if (phase !== "verify-deployed") {
    const latest = await ethers.provider.getBlock("latest");
    if (!latest) throw new Error("latest block unavailable");
    const validAfter = await factory.stagedBundleValidAfter();
    const expiresAt = await factory.stagedBundleExpiresAt();
    if (BigInt(latest.timestamp) < validAfter) throw new Error(`bundle is not mature until ${validAfter}`);
    if (BigInt(latest.timestamp) > expiresAt) throw new Error(`bundle staging expired at ${expiresAt}`);
  }

  if (phase === "bond-check") {
    if ((await factory.deploymentPhase()) < 2n) throw new Error("VerifierBondVaultV2 is not deployed yet");
    const bondVault = await ethers.getContractAt("VerifierBondVaultV2", predicted.verifierBondVault);
    for (const member of panel) {
      if (!(await bondVault.isEligible(member))) throw new Error(`initial panel member is not eligible: ${member}`);
    }
    console.log(JSON.stringify(jsonSafe({ ...reportOut, bondCheck: "passed", panel }), null, 2));
    return;
  }

  if (phase === "verify-deployed") {
    const apiKey = process.env.ETHERSCAN_API_KEY?.trim() || process.env.BASESCAN_API_KEY?.trim();
    if (!apiKey) throw new Error("ETHERSCAN_API_KEY or BASESCAN_API_KEY is required for BaseScan verification");
    const phaseNow = Number(await factory.deploymentPhase());
    const definitions: Array<{ name: string; contract: string; args: unknown[] }> = [
      { name: "AzzleSuiteV2Factory", contract: "src/v2/AzzleSuiteV2Factory.sol:AzzleSuiteV2Factory", args: [] },
      { name: "AzlV4ObservationOracle", contract: "src/v2/AzlV4ObservationOracle.sol:AzlV4ObservationOracle", args: [BASE.poolManager, poolKey, DEFAULTS.twapWindow, DEFAULTS.maxObservationGap] },
      { name: "AzlEthTwapAdapter", contract: "src/v2/AzlEthTwapAdapter.sol:AzlEthTwapAdapter", args: [predicted.observationOracle, DEFAULTS.minimumActiveLiquidity, factoryAddress] },
      { name: "AzlUsdOracle", contract: "src/v2/AzlUsdOracle.sol:AzlUsdOracle", args: [
        predicted.twapAdapter,
        BASE.ethUsdFeed,
        DEFAULTS.maxFeedAge,
        "0xBCF85224fc0756B9Fa45aA7892530B47e10b6433",
      ] },
      { name: "AzlPricingPolicy", contract: "src/v2/AzlPricingPolicy.sol:AzlPricingPolicy", args: [predicted.usdOracle] },
      { name: "AgentDepositVaultV2", contract: "src/v2/AgentDepositVaultV2.sol:AgentDepositVaultV2", args: [BASE.azl, predicted.pricingPolicy, factoryAddress] },
      { name: "EscrowVaultV2", contract: "src/v2/EscrowVaultV2.sol:EscrowVaultV2", args: [BASE.azl, factoryAddress] },
      { name: "ReputationRegistryV2", contract: "src/v2/ReputationRegistryV2.sol:ReputationRegistryV2", args: [factoryAddress] },
      { name: "VerifierBondVaultV2", contract: "src/v2/VerifierBondVaultV2.sol:VerifierBondVaultV2", args: [BASE.azl, DEFAULTS.minimumVerifierBondAzl, 7 * 24 * 60 * 60, predicted.treasuryRouter, factoryAddress] },
      { name: "UnionStakingVaultV2", contract: "src/v2/UnionStakingVaultV2.sol:UnionStakingVaultV2", args: [BASE.azl, DEFAULTS.stakingRewardDuration, factoryAddress] },
      { name: "TreasuryRouterV2", contract: "src/v2/TreasuryRouterV2.sol:TreasuryRouterV2", args: [BASE.azl, burnRecipient, factoryAddress] },
      { name: "TaskRegistryV2", contract: "src/v2/TaskRegistryV2.sol:TaskRegistryV2", args: [predicted.depositVault, predicted.escrowVault, predicted.reputationRegistry, predicted.usdOracle, DEFAULTS.openTaskCapUsd6, factoryAddress] },
      { name: "ArbitrationModuleV2", contract: "src/v2/ArbitrationModuleV2.sol:ArbitrationModuleV2", args: [predicted.taskRegistry, predicted.escrowVault, predicted.reputationRegistry, predicted.verifierBondVault, predicted.treasuryRouter, DEFAULTS.evidenceWindow, DEFAULTS.rulingWindow, DEFAULTS.slashCapBps, panel, factoryAddress] },
      { name: "BaseUsdcWethExactInputLeg", contract: "src/v2/BaseUsdcWethExactInputLeg.sol:BaseUsdcWethExactInputLeg", args: [] },
      { name: "BaseAzlExactInputExecutor", contract: "src/v2/BaseAzlExactInputExecutor.sol:BaseAzlExactInputExecutor", args: [predicted.usdcWethLeg, predicted.usdOracle, DEFAULTS.creditContext, DEFAULTS.maxExecutionDeviationBps, factoryAddress] },
      { name: "AzlPaymentGateway", contract: "src/v2/AzlPaymentGateway.sol:AzlPaymentGateway", args: [BASE.usdc, BASE.azl, predicted.usdOracle, predicted.exactInputExecutor, predicted.depositVault, factoryAddress] },
      { name: "TaskScopeRegistryV2", contract: "src/v2/TaskScopeRegistryV2.sol:TaskScopeRegistryV2", args: [predicted.taskRegistry] },
    ];
    const deployedCount = phaseNow === 0 ? 0 : phaseNow === 1 ? 6 : phaseNow === 2 ? 11 : 16;
    if (deployedCount === 0) throw new Error("no V2 components are deployed yet");
    for (let index = 0; index < deployedCount; ++index) {
      const expected = predicted[COMPONENT_NAMES[index]];
      const actual = await factory.deployedComponent(index);
      if (actual.toLowerCase() !== expected.toLowerCase() || (await ethers.provider.getCode(actual)) === "0x") {
        throw new Error(
          `component ${index} (${COMPONENT_NAMES[index]}) is not deployed at its committed address: expected ${expected}, got ${actual}`
        );
      }
    }
    const submit = async (definition: { name: string; contract: string; args: unknown[] }, address: string) => {
      try {
        await hre.run("verify:verify", { address, constructorArguments: definition.args, contract: definition.contract });
        console.log(`Verified ${definition.name}: ${address}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already verified/i.test(message)) {
          console.log(`Already verified ${definition.name}: ${address}`);
          return;
        }
        throw error;
      }
    };
    await submit(definitions[0], factoryAddress);
    for (let index = 0; index < deployedCount; ++index) {
      await submit(definitions[index + 1], await factory.deployedComponent(index));
    }
    console.log(`Submitted verification for factory and ${deployedCount} deployed V2 components.`);
    return;
  }

  const batches: Record<string, number> = { "deploy-a": 0, "deploy-b": 1, "deploy-c": 2 };
  const batchRanges: Record<string, [number, number]> = {
    "deploy-a": [0, 5],
    "deploy-b": [6, 10],
    "deploy-c": [11, 15],
  };
  const BASE_MAX_TX_INPUT_BYTES = 131_072;

  if (phase === "finalize") {
    if ((await factory.deploymentPhase()) !== 3n) throw new Error("all three deployment batches must complete before finalization");
    const calldata = factory.interface.encodeFunctionData("finalize", []);
    const calldataBytes = calldata.length / 2 - 1;
    if (calldataBytes > BASE_MAX_TX_INPUT_BYTES) {
      throw new Error(`finalize calldata ${calldataBytes} bytes exceeds Base limit ${BASE_MAX_TX_INPUT_BYTES}`);
    }
    const gasEstimate = await ethers.provider.estimateGas({ from: deployer.address, to: factoryAddress, data: calldata });
    const tx = await factory.finalize({ gasLimit: (gasEstimate * 120n) / 100n });
    const receipt = await tx.wait();
    if (!receipt) throw new Error("V2 finalization receipt missing");
    const manifest = {
      version: "2.0.0", chainId: BASE.chainId.toString(), deploymentBlock: receipt.blockNumber,
      deployer: deployer.address, governance, factory: factoryAddress, bundleHash, ...predicted,
      external: jsonSafe(BASE),
      risk: jsonSafe(config), actionCredits, finalizedTx: tx.hash,
    };
    writeExclusiveAtomic(V2_RECEIPT, manifest);
    console.log(`V2 candidate receipt written to ${V2_RECEIPT}`);
    return;
  }
  const batch = batches[phase];
  if (batch === undefined) throw new Error(`phase ${phase} cannot submit a deployment batch`);
  if ((await factory.deploymentPhase()) !== BigInt(batch)) throw new Error(`factory deployment phase is not ready for ${phase}`);
  const [first, last] = batchRanges[phase];
  const batchCodes = codes.slice(first, last + 1);
  const calldata = factory.interface.encodeFunctionData("deployBatch", [batchCodes, batch]);
  const calldataBytes = calldata.length / 2 - 1;
  if (calldataBytes > BASE_MAX_TX_INPUT_BYTES) {
    throw new Error(`${phase} calldata ${calldataBytes} bytes exceeds Base limit ${BASE_MAX_TX_INPUT_BYTES}`);
  }
  await assertDeployBatch(factory, batchCodes, batch, deployer.address);
  const gasEstimate = await ethers.provider.estimateGas({ from: deployer.address, to: factoryAddress, data: calldata });
  const tx = await factory.deployBatch(batchCodes, batch, { gasLimit: (gasEstimate * 120n) / 100n });
  const receipt = await tx.wait();
  if (!receipt) throw new Error(`V2 ${phase} receipt missing`);
  console.log(JSON.stringify(jsonSafe({ ...reportOut, tx: tx.hash, gasEstimate, deploymentPhase: await factory.deploymentPhase() }), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
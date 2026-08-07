import { createPublicClient, formatUnits, http } from "viem";
import { base } from "viem/chains";
import MANIFEST from "../../contracts/deployments/base-8453.json" with { type: "json" };
import { fetchAzlUsdPrice } from "./azl-price-lite.js";

const WAD = 10n ** 18n;
const ERC20_ABI = [
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];
const USD_ORACLE_ABI = [
  { type: "function", name: "isValid", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "ethUsdFeed", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "quoteUsdForAzlPar",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "quoteEthUsd6",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
];
const TWAP_ADAPTER_ABI = [
  { type: "function", name: "isReady", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "azlPerEth", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "referenceActivatedAt", stateMutability: "view", inputs: [], outputs: [{ type: "uint64" }] },
];
const OBSERVATION_ORACLE_ABI = [
  { type: "function", name: "twapWindow", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  { type: "function", name: "maxObservationGap", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
  {
    type: "function", name: "latestObservation", stateMutability: "view", inputs: [], outputs: [
      {
        type: "tuple", components: [
          { name: "timestamp", type: "uint64" },
          { name: "tick", type: "int24" },
          { name: "tickCumulative", type: "int56" },
        ],
      },
    ],
  },
];

const BASESCAN_ADDRESS = "https://basescan.org/address/";
const DEXSCREENER_PAIR = "https://dexscreener.com/base/";

export async function getAzlMarket() {
  const tokenAddress = MANIFEST.external.azl;
  const rpc = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org"),
  });

  const [marketResult, supplyResult] = await Promise.allSettled([
    fetchAzlUsdPrice(),
    rpc.multicall({
      contracts: ["totalSupply", "decimals"].map((functionName) => ({
        address: tokenAddress,
        abi: ERC20_ABI,
        functionName,
      })),
    }),
  ]);
  // These calls are independent. Run direct calls concurrently: this avoids
  // serial RPC latency while allowing a non-core metadata call to fail alone.
  const oracleRequests = [
    // This is the high-precision source used for the displayed oracle price.
    { address: MANIFEST.twapAdapter, abi: TWAP_ADAPTER_ABI, functionName: "azlPerEth" },
    { address: MANIFEST.usdOracle, abi: USD_ORACLE_ABI, functionName: "quoteEthUsd6", args: [WAD] },
    { address: MANIFEST.usdOracle, abi: USD_ORACLE_ABI, functionName: "isValid" },
    { address: MANIFEST.usdOracle, abi: USD_ORACLE_ABI, functionName: "quoteUsdForAzlPar", args: [10n ** 18n] },
    { address: MANIFEST.usdOracle, abi: USD_ORACLE_ABI, functionName: "ethUsdFeed" },
    { address: MANIFEST.twapAdapter, abi: TWAP_ADAPTER_ABI, functionName: "isReady" },
    { address: MANIFEST.twapAdapter, abi: TWAP_ADAPTER_ABI, functionName: "referenceActivatedAt" },
    { address: MANIFEST.observationOracle, abi: OBSERVATION_ORACLE_ABI, functionName: "twapWindow" },
    { address: MANIFEST.observationOracle, abi: OBSERVATION_ORACLE_ABI, functionName: "maxObservationGap" },
    { address: MANIFEST.observationOracle, abi: OBSERVATION_ORACLE_ABI, functionName: "latestObservation" },
  ];
  const oracleReads = await Promise.allSettled(
    oracleRequests.map((request) => rpc.readContract(request))
  );
  const ethUsdFeedAddress = oracleReads[4].status === "fulfilled" ? oracleReads[4].value : null;

  const market = marketResult.status === "fulfilled" ? marketResult.value : null;
  const supplyReads = supplyResult.status === "fulfilled" ? supplyResult.value : null;
  const totalSupply = supplyReads?.[0]?.result;
  const decimals = supplyReads?.[1]?.result;
  const pair = market?.pair ?? null;
  const read = (index) => oracleReads[index].status === "fulfilled" ? oracleReads[index].value : null;
  const observation = read(9);
  const observedAt = observation ? Number(observation.timestamp) : null;
  const twapWindowSeconds = read(7) === null
    ? Number(MANIFEST.risk?.twapWindow ?? 0) || null
    : Number(read(7));
  const maxObservationGapSeconds = read(8) === null
    ? Number(MANIFEST.risk?.maxObservationGap ?? 0) || null
    : Number(read(8));
  const now = Math.floor(Date.now() / 1000);
  const observationAgeSeconds = observedAt === null ? null : Math.max(0, now - observedAt);
  const observationFresh = observationAgeSeconds !== null && maxObservationGapSeconds !== null
    ? observationAgeSeconds <= maxObservationGapSeconds
    : null;
  const oracleParUsd6 = read(3);
  const dexPriceUsd = market?.priceUsd ?? null;
  const azlPerEthWei = read(0);
  const ethUsd6 = read(1);
  // azlPerEth is 18-decimal AZL per 1 ETH. Preserve that precision through
  // the division, instead of using the USD6 settlement quote (which rounds
  // prices below one micro-dollar to a whole USDC6 unit).
  const oraclePriceUsdWad = azlPerEthWei !== null && ethUsd6 && ethUsd6 > 0n
    ? (ethUsd6 * 10n ** 12n * WAD) / azlPerEthWei
    : null;
  const oraclePriceUsd = oraclePriceUsdWad === null ? null : Number(formatUnits(oraclePriceUsdWad, 18));
  const deviationBps = oraclePriceUsd && dexPriceUsd
    ? Math.round(((dexPriceUsd - oraclePriceUsd) / oraclePriceUsd) * 10_000)
    : null;

  return {
    chainId: Number(MANIFEST.chainId),
    chainName: "Base",
    token: {
      symbol: "AZL",
      address: tokenAddress,
      decimals: Number(decimals ?? 18),
      baseScanUrl: BASESCAN_ADDRESS + tokenAddress,
      totalSupplyWei: totalSupply?.toString() ?? null,
      totalSupply: totalSupply === undefined ? null : formatUnits(totalSupply, Number(decimals ?? 18)),
    },
    market: market
      ? {
          priceUsd: market.priceUsd,
          priceUsdExact: market.priceUsdExact ?? String(market.priceUsd),
          liquidityUsd: market.liquidityUsd,
          source: market.source,
          updatedAt: market.updatedAt,
          pair,
          dexScreenerUrl: pair ? DEXSCREENER_PAIR + pair : null,
        }
      : null,
    oracle: {
      valid: read(2),
      parUsd6: oracleParUsd6 === null ? null : oracleParUsd6.toString(),
      settlementPriceUsd: oracleParUsd6 === null ? null : formatUnits(oracleParUsd6, 6),
      impliedPriceUsdWad: oraclePriceUsdWad === null ? null : oraclePriceUsdWad.toString(),
      impliedPriceUsd: oraclePriceUsdWad === null ? null : formatUnits(oraclePriceUsdWad, 18),
      twapReady: read(5),
      azlPerEthWei: azlPerEthWei === null ? null : azlPerEthWei.toString(),
      azlPerEth: azlPerEthWei === null ? null : formatUnits(azlPerEthWei, 18),
      ethUsd: ethUsd6 === null ? null : formatUnits(ethUsd6, 6),
      referenceActivatedAt: read(6) === null ? null : Number(read(6)),
      dexComparison: {
        dexPriceUsd: market?.priceUsdExact ?? dexPriceUsd,
        oraclePriceUsd,
        deviationBps,
      },
      observation: {
        observedAt,
        ageSeconds: observationAgeSeconds,
        fresh: observationFresh,
        twapWindowSeconds,
        maxObservationGapSeconds,
        latestReadAvailable: observation !== null,
      },
      contracts: {
        usdOracle: MANIFEST.usdOracle,
        ethUsdFeed: ethUsdFeedAddress,
        twapAdapter: MANIFEST.twapAdapter,
        observationOracle: MANIFEST.observationOracle,
      },
    },
    errors: {
      market: marketResult.status === "rejected" ? (marketResult.reason?.message ?? String(marketResult.reason)) : null,
      supply: supplyResult.status === "rejected" ? (supplyResult.reason?.message ?? String(supplyResult.reason)) : null,
      oracle: oracleReads[0].status !== "fulfilled" || oracleReads[1].status !== "fulfilled"
        || oracleReads[2].status !== "fulfilled"
        ? "Core Base oracle health checks could not be read."
        : null,
    },
  };
}

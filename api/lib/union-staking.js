import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import MANIFEST from "./contracts.json" with { type: "json" };

const ABI = [
  { type: "function", name: "stakingActive", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "totalStaked", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalCreditsIssued", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "totalCreditsSpent", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditsRemaining", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "creditIssuanceClosed", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
  { type: "function", name: "rewardPeriodFinish", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "rewardUsdcReserve", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

export async function getUnionOverview() {
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL ?? "https://mainnet.base.org") });
  const results = await client.multicall({
    contracts: ["stakingActive", "totalStaked", "totalCreditsIssued", "totalCreditsSpent", "creditsRemaining", "creditIssuanceClosed", "rewardPeriodFinish", "rewardUsdcReserve"]
      .map((functionName) => ({ address: MANIFEST.stakingVault, abi: ABI, functionName })),
  });
  const value = (index) => results[index].result;
  return {
    source: "base-rpc", updatedAt: Math.floor(Date.now() / 1000),
    stakingActive: value(0), totalStakedAzl: value(1).toString(),
    totalCreditsIssued: value(2).toString(), totalCreditsSpent: value(3).toString(),
    creditsRemaining: value(4).toString(), creditIssuanceClosed: value(5),
    rewardPeriodFinish: Number(value(6)), rewardUsdcReserve: value(7).toString(),
  };
}

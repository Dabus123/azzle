import { ethers } from "ethers";

const SETTLEMENT_TYPES = {
  Settlement: [
    { name: "settlementDigest", type: "bytes32" },
    { name: "poster", type: "address" },
    { name: "worker", type: "address" },
    { name: "chainId", type: "uint256" },
  ],
};

export function buildSettlementTypedData(params: {
  settlementDigest: string;
  poster: string;
  worker: string;
  chainId: bigint;
}) {
  return {
    domain: {
      name: "AZZLE Settlement v1",
      version: "1",
      chainId: params.chainId,
    },
    types: SETTLEMENT_TYPES,
    primaryType: "Settlement" as const,
    message: {
      settlementDigest: params.settlementDigest,
      poster: params.poster,
      worker: params.worker,
      chainId: params.chainId,
    },
  };
}

export function recoverSettlementSigner(
  settlementDigest: string,
  signature: string,
  poster: string,
  worker: string,
  chainId: bigint
): string {
  const typed = buildSettlementTypedData({
    settlementDigest,
    poster,
    worker,
    chainId,
  });
  try {
    return ethers.verifyTypedData(
      typed.domain,
      typed.types,
      typed.message,
      signature
    );
  } catch {
    return ethers.verifyMessage(ethers.getBytes(settlementDigest), signature);
  }
}

export function assertCounterpartySignature(
  settlementDigest: string,
  signature: string,
  expectedAddress: string,
  poster: string,
  worker: string,
  chainId: bigint
): void {
  const recovered = recoverSettlementSigner(
    settlementDigest,
    signature,
    poster,
    worker,
    chainId
  );
  if (recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(
      `TaskAcceptance signature mismatch: expected ${expectedAddress}, recovered ${recovered}`
    );
  }
}

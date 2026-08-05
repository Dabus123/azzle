export interface TaskTerms {
  poster: string;
  worker: string;
  totalAmount: bigint;
  deadline: number;
  acceptanceCriteriaHash: string;
  chainId: bigint;
  registryAddress: string;
}

export interface AzzleClientConfig {
  rpcUrl: string;
  /** Settlement domain chain id; defaults to Base mainnet (8453). */
  chainId?: bigint;
  registryAddress: string;
  escrowAddress: string;
  arbitrationAddress?: string;
  agentVaultAddress?: string;
  /** UnionStakingVault address; defaults to the Base mainnet manifest entry. */
  stakingVaultAddress?: string;
  /** TaskScopeRegistry address; defaults to the Base mainnet manifest entry. */
  taskScopeAddress?: string;
  signer?: { address: string; signMessage: (msg: string) => Promise<string> };
}

export interface ExecutionReceipt {
  schemaVersion: "azzle-receipt-v2";
  taskId: string;
  worker: string;
  completedAt: string;
  artifacts: Array<{ type: string; hash: string; uri?: string }>;
  gitProvenance?: { repository?: string; commit?: string; diffHash?: string };
  deterministicOutput?: { inputHash?: string; outputHash?: string; verifierCommand?: string };
  testResults?: { passed?: number; failed?: number; reportHash?: string };
  previousReceiptHash?: string;
  availability?: {
    retrievalUri: string;
    verifiedAt: string;
    contentAddressed?: boolean;
  };
  receiptHash: string;
}

export const TASK_SCHEMA_VERSION = "azzle-task-v2";

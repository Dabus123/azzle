export type EscrowMode = "upfront" | "milestone" | "streaming" | "hour_blocks";

export interface TaskTerms {
  poster: string;
  worker: string;
  token: string;
  totalAmount: bigint;
  escrowMode: EscrowMode;
  milestoneAmounts?: bigint[];
  deadline: number;
  acceptanceCriteriaHash: string;
  replacementAllowed: boolean;
  feeBps?: number;
}

export interface AzzleClientConfig {
  rpcUrl: string;
  registryAddress: string;
  escrowAddress: string;
  arbitrationAddress?: string;
  agentVaultAddress?: string;
  signer?: { address: string; signMessage: (msg: string) => Promise<string> };
}

export interface ExecutionReceipt {
  schemaVersion: "azzle-receipt-v1";
  taskId: string;
  milestoneIndex: number;
  worker: string;
  completedAt: string;
  artifacts: Array<{ type: string; hash: string; uri?: string }>;
  receiptHash: string;
}

export const TASK_SCHEMA_VERSION = "azzle-task-v1";

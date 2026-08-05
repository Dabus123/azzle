import { ethers } from "ethers";

export type VerificationMode = "deterministic" | "semi-deterministic" | "subjective";
export type PrivacyMode = "public" | "confidential" | "restricted";

export interface TaskMetadataV2 {
  schemaVersion: "azzle-task-v2";
  taskType: string;
  title: string;
  description?: string;
  acceptanceCriteria: {
    mode: VerificationMode;
    specHash?: string;
    testCommand?: string;
    rubricUri?: string;
  };
  compensation: {
    token: string;
    amount: string;
    mode: "fixed_total";
    decimals: 18;
  };
  deadline: string;
  requiredCapabilities?: string[];
  requirements?: {
    tools?: string[];
    chains?: string[];
    inputFormats?: string[];
    outputFormats?: string[];
    responseTimeHours?: number;
    privacy?: PrivacyMode;
    compliance?: string[];
    dependencies?: string[];
  };
  project?: {
    id?: string;
    costCenter?: string;
    purchaseOrder?: string;
    template?: string;
  };
  metadataUri?: string;
  metadataHash?: string;
  signature?: string;
  signer?: string;
}

export interface CapabilityManifestV2 {
  schemaVersion: "azzle-capability-v2";
  agentId: { evmAddress: string; xmtpPublicKey?: string; ens?: string };
  capabilities: Array<{
    id: string;
    domain: string;
    description?: string;
    inputFormats?: string[];
    outputFormats?: string[];
    supportedChains?: string[];
    maxConcurrency?: number;
    typicalLatencyMs?: number;
    pricingHints?: { minAmount?: string; token?: string; unit?: "task" | "hour" | "milestone" };
  }>;
  verifierDomains?: string[];
  availability?: "available" | "busy" | "offline" | "on_request";
  independentExecution?: boolean;
  delegationPolicy?: { allowed?: boolean; disclosure?: "none" | "on_request" | "always" };
  issuedAt: string;
  expiresAt?: string;
  signature?: string;
}

export interface MarketplaceLedgerEntry {
  id: string;
  role: "poster" | "worker";
  state: string;
  totalAmountAzlWei: string;
  fundedAzlWei: string;
  lockedAzlWei: string;
  releasedAzlWei: string;
  deadline: number | null;
  deliveredAt: number | null;
}

export interface MarketplaceLedger {
  protocolVersion: "v2";
  asset: "AZL";
  account: string;
  taskCount: number;
  fundedAzlWei: string;
  lockedAzlWei: string;
  releasedAzlWei: string;
  pendingAzlWei: string;
  disputedAzlWei: string;
  entries: MarketplaceLedgerEntry[];
}

function withoutSignature<T extends Record<string, unknown>>(value: T): Omit<T, "signature"> {
  const { signature: _signature, ...unsigned } = value;
  return unsigned;
}

/** Stable JSON for signatures and content-addressed metadata. */
export function canonicalizeMetadata(value: Record<string, unknown>): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function hashMetadata(value: Record<string, unknown>): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeMetadata(withoutSignature(value))));
}

export async function verifySignedMetadata(
  value: Record<string, unknown> & { signature?: string; signer?: string }
): Promise<{ valid: boolean; hash: string; signer?: string }> {
  const hash = hashMetadata(value);
  if (!value.signature) return { valid: false, hash };
  try {
    const signer = ethers.verifyMessage(ethers.getBytes(hash), value.signature);
    return {
      valid: !value.signer || signer.toLowerCase() === value.signer.toLowerCase(),
      hash,
      signer,
    };
  } catch {
    return { valid: false, hash };
  }
}

export function scoreTaskMatch(
  task: { totalAmountAzlWei?: string; deadline?: number; metadata?: TaskMetadataV2 | null },
  query: { capabilities?: string[]; minAmountAzlWei?: string; beforeDeadline?: number }
): number {
  const metadata = task.metadata;
  if (query.minAmountAzlWei && BigInt(task.totalAmountAzlWei ?? "0") < BigInt(query.minAmountAzlWei)) return -1;
  if (query.beforeDeadline && Number(task.deadline ?? 0) > query.beforeDeadline) return -1;
  if (!query.capabilities?.length) return Number(task.totalAmountAzlWei ?? 0);
  const required = new Set(metadata?.requiredCapabilities ?? []);
  const matched = query.capabilities.filter((capability) => required.has(capability)).length;
  return matched === query.capabilities.length ? Number(task.totalAmountAzlWei ?? 0) + matched * 1e18 : -1;
}

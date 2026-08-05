import { ethers } from "ethers";

export interface PrivateTaskPreview {
  schemaVersion: "azzle-private-preview-v1";
  invitationId: string;
  taskType: string;
  capabilityHints: string[];
  budgetBand?: { minAzlWei?: string; maxAzlWei?: string };
  responseBy?: string;
  expiresAt: string;
  sender: string;
  signature?: string;
}

export interface CapabilityQuote {
  schemaVersion: "azzle-capability-quote-v1";
  invitationId: string;
  worker: string;
  capabilities: string[];
  amountAzlWei: string;
  deadline: string;
  acceptanceCriteriaHash: string;
  expiresAt: string;
  signature?: string;
}

export function privateRoutingHash(value: Record<string, unknown>): string {
  return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(value, Object.keys(value).sort())));
}

export function isPrivatePreviewActive(preview: PrivateTaskPreview, now = Date.now()): boolean {
  return Date.parse(preview.expiresAt) > now;
}

export function isCapabilityQuoteActive(quote: CapabilityQuote, now = Date.now()): boolean {
  return Date.parse(quote.expiresAt) > now;
}

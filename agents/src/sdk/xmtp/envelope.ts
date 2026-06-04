import { ethers } from "ethers";
import type { AzzleEnvelope, EnvelopeSender } from "./types.js";
import { ENVELOPE_SCHEMA_VERSION } from "./types.js";
import { validateEnvelopeShape } from "./validation.js";

const ZERO_HASH = "0x" + "00".repeat(32);

export function canonicalizeEnvelope(envelope: AzzleEnvelope): string {
  const clone = { ...envelope };
  delete (clone as { payload?: unknown }).payload;
  const ordered = JSON.stringify(clone, Object.keys(clone).sort());
  const payload = JSON.stringify(envelope.payload, Object.keys(envelope.payload).sort());
  return ordered + payload;
}

export function hashEnvelope(envelope: AzzleEnvelope): string {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeEnvelope(envelope)));
}

export function validateEnvelope(envelope: unknown): envelope is AzzleEnvelope {
  validateEnvelopeShape(envelope);
  return true;
}

export function assertValidEnvelope(envelope: unknown): AzzleEnvelope {
  if (!validateEnvelope(envelope)) {
    throw new Error("Invalid XMTP envelope");
  }
  return envelope;
}

export interface BuildEnvelopeParams {
  type: string;
  negotiationId: string;
  payload: Record<string, unknown>;
  sender: EnvelopeSender;
  sequence: number;
  previousHash?: string;
  taskId?: string;
  timestamp?: string;
}

export function buildEnvelope(params: BuildEnvelopeParams): AzzleEnvelope {
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    type: params.type,
    negotiationId: params.negotiationId,
    taskId: params.taskId,
    sequence: params.sequence,
    previousHash: params.previousHash ?? ZERO_HASH,
    timestamp: params.timestamp ?? new Date().toISOString(),
    sender: params.sender,
    payload: params.payload,
  };
}

import { createHash, createVerify } from "node:crypto";

const METADATA_CACHE = new Map();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
  return JSON.stringify(value, Object.keys(value).sort());
}

export function metadataHash(metadata) {
  return `sha256:${sha256(canonicalize(metadata))}`;
}

export function validateTaskMetadata(metadata) {
  if (!metadata || metadata.schemaVersion !== "azzle-task-v2") {
    return { valid: false, errors: ["schemaVersion must be azzle-task-v2"] };
  }
  const errors = [];
  if (typeof metadata.taskType !== "string" || !metadata.taskType) errors.push("taskType is required");
  if (typeof metadata.title !== "string" || !metadata.title) errors.push("title is required");
  if (metadata.acceptanceCriteria?.mode === undefined) errors.push("acceptanceCriteria.mode is required");
  if (metadata.compensation?.mode !== "fixed_total") errors.push("compensation.mode must be fixed_total");
  if (metadata.compensation?.decimals !== 18) errors.push("compensation.decimals must be 18");
  return { valid: errors.length === 0, errors };
}

export async function resolveMetadata(uri) {
  if (!uri || typeof uri !== "string" || !/^https?:\/\//i.test(uri)) return null;
  if (METADATA_CACHE.has(uri)) return METADATA_CACHE.get(uri);
  const response = await fetch(uri, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) return null;
  const metadata = await response.json();
  const result = validateTaskMetadata(metadata).valid ? metadata : null;
  METADATA_CACHE.set(uri, result);
  return result;
}

export function metadataTrust(metadata) {
  const validation = validateTaskMetadata(metadata);
  return {
    valid: validation.valid,
    signed: typeof metadata?.signature === "string" && typeof metadata?.signer === "string",
    contentAddressed: typeof metadata?.metadataHash === "string" || typeof metadata?.metadataUri === "string",
    errors: validation.errors,
  };
}

export function rankTask(task, filters = {}) {
  const metadata = task.metadata;
  if (filters.minAmountAzlWei && BigInt(task.totalAmountAzlWei ?? "0") < BigInt(filters.minAmountAzlWei)) return -1;
  if (filters.beforeDeadline && Number(task.deadline ?? 0) > Number(filters.beforeDeadline)) return -1;
  if (filters.taskType && metadata?.taskType !== filters.taskType) return -1;
  if (filters.verificationMode && metadata?.acceptanceCriteria?.mode !== filters.verificationMode) return -1;
  const wanted = Array.isArray(filters.capability) ? filters.capability : [];
  const available = new Set(metadata?.requiredCapabilities ?? []);
  if (wanted.some((item) => !available.has(item))) return -1;
  const capabilityScore = wanted.length ? wanted.length * 1000 : 0;
  const deterministicScore = metadata?.acceptanceCriteria?.mode === "deterministic" ? 100 : 0;
  return capabilityScore + deterministicScore + Math.min(Number(task.totalAmountAzlWei ?? 0) / 1e18, 1_000_000);
}

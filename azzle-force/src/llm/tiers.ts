import type { ModelTier } from "../types.js";

/** Bankr Gateway model IDs — see https://docs.bankr.bot/llm-gateway/models */
export const TIER_MODELS: Record<ModelTier, string[]> = {
  cheap: [
    "deepseek-v4-flash",
    "gemini-2.5-flash",
    "qwen3.6-flash",
    "claude-haiku-4.5",
    "gpt-5.4-nano",
  ],
  medium: [
    "deepseek-v4-flash",
    "deepseek-v4-pro",
    "claude-sonnet-4.6",
    "gpt-5.2",
    "gemini-3-flash",
    "kimi-k2.5",
    "claude-haiku-4.5",
  ],
  frontier: [
    "deepseek-v4-pro",
    "claude-opus-4.8",
    "gpt-5.5",
    "gemini-3.1-pro",
    "grok-4.3",
    "claude-sonnet-4.6",
  ],
};

const TIER_ENV_KEYS: Record<ModelTier, string> = {
  cheap: "AZZLE_LLM_MODEL_CHEAP",
  medium: "AZZLE_LLM_MODEL_MEDIUM",
  frontier: "AZZLE_LLM_MODEL_FRONTIER",
};

function tierModelOverride(tier: ModelTier): string | undefined {
  const tierSpecific = process.env[TIER_ENV_KEYS[tier]]?.trim();
  if (tierSpecific) return tierSpecific;
  return process.env.AZZLE_LLM_MODEL?.trim();
}

export function modelsForTier(tier: ModelTier): string[] {
  const override = tierModelOverride(tier);
  const base = TIER_MODELS[tier];
  if (!override) return base;
  const rest = base.filter((m) => m !== override);
  return [override, ...rest];
}

export function modelForTier(tier: ModelTier): string {
  return modelsForTier(tier)[0];
}

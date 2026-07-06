import { createHash } from "node:crypto";
import { createContext } from "../orchestrator.js";
import type { ForceContext } from "../context.js";
import { Sequencer } from "../agents/brain/sequencer.js";

let cached: ForceContext | null = null;

export async function getActivityContext(): Promise<ForceContext> {
  if (!cached) {
    cached = await createContext(false);
  }
  return cached;
}

/** Deterministic poster entity id from wallet (lite + postgres compatible). */
export function walletEntityId(wallet: string): string {
  const hex = createHash("sha256").update(wallet.toLowerCase()).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

import { getActivityContext } from "./activity-context.js";
import { Sequencer } from "../agents/brain/sequencer.js";

export async function logFollowUp(entityId: string, sequence: number): Promise<void> {
  console.log(`[temporal] follow-up #${sequence} for entity ${entityId}`);
  try {
    const ctx = await getActivityContext();
    await Sequencer.runStep(ctx, entityId, sequence);
  } catch (err) {
    console.error(`[temporal] follow-up draft failed:`, err);
  }
}

export async function markCold(entityId: string): Promise<void> {
  console.log(`[temporal] marked cold: ${entityId}`);
  const ctx = await getActivityContext();
  await ctx.postgres.upsertScore(entityId, "relationship_heat", 0.05, "cadence exhausted — cold");
}

export async function sendOnboardingStep(
  entityId: string,
  stepIndex: number,
  step: string
): Promise<void> {
  console.log(`[temporal] onboarding step ${stepIndex} for ${entityId}: ${step}`);
}

export async function logSpawnApproval(niche: string, agents: string[]): Promise<void> {
  console.log(`[temporal] spawn approved for ${niche}: ${agents.join(", ")}`);
}

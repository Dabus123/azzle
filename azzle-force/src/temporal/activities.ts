export async function logFollowUp(entityId: string, sequence: number): Promise<void> {
  console.log(`[temporal] follow-up #${sequence} for entity ${entityId}`);
}

export async function markCold(entityId: string): Promise<void> {
  console.log(`[temporal] marked cold: ${entityId}`);
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

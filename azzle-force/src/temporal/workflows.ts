import { proxyActivities, sleep, defineSignal, setHandler, condition } from "@temporalio/workflow";

export const replyReceivedSignal = defineSignal("reply_received");

const { logFollowUp, markCold } = proxyActivities<typeof import("./activities.js")>({
  startToCloseTimeout: "1 minute",
});

export async function followUpWorkflow(
  entityId: string,
  followUpDays: number[] = [3, 7, 14]
): Promise<void> {
  let replied = false;
  setHandler(replyReceivedSignal, () => {
    replied = true;
  });

  for (let i = 0; i < followUpDays.length; i++) {
    await condition(() => replied, followUpDays[i] * 24 * 60 * 60 * 1000);
    if (replied) return;
    await logFollowUp(entityId, i + 1);
  }

  if (!replied) {
    await markCold(entityId);
  }
}

export async function onboardingDripWorkflow(
  entityId: string,
  steps: string[]
): Promise<void> {
  const { sendOnboardingStep } = proxyActivities<typeof import("./activities.js")>({
    startToCloseTimeout: "1 minute",
  });

  for (let i = 0; i < steps.length; i++) {
    await sendOnboardingStep(entityId, i, steps[i]);
    await sleep(24 * 60 * 60 * 1000);
  }
}

export async function spawnApprovalWorkflow(
  niche: string,
  agents: string[]
): Promise<void> {
  const { logSpawnApproval } = proxyActivities<typeof import("./activities.js")>({
    startToCloseTimeout: "1 minute",
  });
  await logSpawnApproval(niche, agents);
}

import type { ForceContext } from "../context.js";
import { draftSequencerMessage } from "../brain/outreach-engine.js";

const MS_PER_DAY = 86_400_000;

/** Follow-up cadence when Temporal is unavailable (lite mode). */
export async function tickLiteFollowUps(ctx: ForceContext): Promise<number> {
  const days = ctx.config.forceConfig.followUpDays;
  if (days.length === 0) return 0;

  const sentIds = await ctx.postgres.entitiesWithLatestOutreachStatus("sent");
  let drafted = 0;

  for (const entityId of sentIds) {
    const history = await ctx.postgres.listOutreachForEntity(entityId);
    if (history.some((o) => o.status === "replied" || o.status === "converted")) continue;

    const sends = history.filter((o) => o.status === "sent");
    if (sends.length === 0) continue;

    const touchCount = sends.length;
    const stepIndex = touchCount - 1;
    if (stepIndex >= days.length) continue;

    const lastSent = sends[sends.length - 1];
    const lastAt = new Date(String(lastSent.sent_at ?? lastSent.created_at)).getTime();
    const waitDays = days[stepIndex];
    if (Date.now() - lastAt < waitDays * MS_PER_DAY) continue;

    const hasPending = history.some((o) =>
      ["draft", "pending_approval"].includes(String(o.status))
    );
    if (hasPending) continue;

    await draftSequencerMessage(ctx, entityId, touchCount + 1);
    drafted++;
    if (drafted >= 5) break;
  }

  return drafted;
}

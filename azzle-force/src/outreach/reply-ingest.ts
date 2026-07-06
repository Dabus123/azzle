import type { ForceContext } from "../context.js";
import { SUBJECTS } from "../events/subjects.js";
import { resolveContacts } from "../delivery/contacts.js";
import type { PostgresStore } from "../graph/postgres.js";

export interface IngestReplyInput {
  fromEmail: string;
  body: string;
  subject?: string;
  source?: string;
  messageId?: string;
  entityId?: string;
}

export interface IngestReplyResult {
  ok: boolean;
  entityId?: string;
  message: string;
}

/** Match sender to entity — prefer whoever we most recently sent to. */
export async function findEntityByEmail(
  store: PostgresStore,
  email: string
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  if (!target.includes("@")) return null;

  const entities = await store.listEntities(50_000);
  let bestId: string | null = null;
  let bestSentAt = "";
  let fallbackId: string | null = null;

  for (const row of entities) {
    const id = String(row.id);
    const record = row as Record<string, unknown>;
    const contacts = resolveContacts(record);
    if (!contacts.emails.includes(target)) continue;

    fallbackId = id;
    const history = await store.listOutreachForEntity(id);
    const sends = history.filter((o) => o.status === "sent");
    if (sends.length === 0) continue;

    const lastSent = sends[sends.length - 1];
    const sentAt = String(lastSent.sent_at ?? lastSent.created_at ?? "");
    if (sentAt > bestSentAt) {
      bestSentAt = sentAt;
      bestId = id;
    }
  }

  return bestId ?? fallbackId;
}

export async function ingestProspectReply(
  ctx: ForceContext,
  input: IngestReplyInput
): Promise<IngestReplyResult> {
  const from = input.fromEmail.trim().toLowerCase();
  const body = input.body.trim();
  if (!from || !body) {
    return { ok: false, message: "fromEmail and body required" };
  }

  const entityId =
    input.entityId ?? (await findEntityByEmail(ctx.postgres, from));
  if (!entityId) {
    console.warn(`[reply-ingest] no entity for ${from} — subject: ${input.subject ?? "(none)"}`);
    return { ok: false, message: `no entity matched ${from}` };
  }

  const latest = await ctx.postgres.getLatestOutreach(entityId);
  if (latest?.status === "replied") {
    const prev = String(latest.body ?? "");
    if (prev === body || prev.includes(body.slice(0, 80))) {
      return { ok: true, entityId, message: "duplicate reply ignored" };
    }
  }

  await ctx.postgres.logOutreach(entityId, "email", "replied", {
    body: body.slice(0, 4000),
    subject: input.subject,
  });

  await ctx.postgres.recordSignal(entityId, "reply-ingest", "email_reply", 0.95, {
    from,
    subject: input.subject,
    source: input.source ?? "manual",
    message_id: input.messageId,
  });

  const fit = await ctx.postgres.getScore(entityId, "azzle_probability");
  const prevHeat = await ctx.postgres.getScore(entityId, "relationship_heat");
  const heat = Math.min(1, Math.max(prevHeat?.value ?? 0, 0.85, (fit?.value ?? 0.5) + 0.2));
  await ctx.postgres.upsertScore(
    entityId,
    "relationship_heat",
    heat,
    `reply from ${from} via ${input.source ?? "manual"}`
  );

  await ctx.bus.publish(
    SUBJECTS.OUTREACH_REPLIED,
    input.source ?? "reply-ingest",
    {
      reply_text: body,
      from_email: from,
      subject: input.subject,
    },
    entityId
  );

  await ctx.bus.publish(
    SUBJECTS.SCORE_UPDATED,
    "reply-ingest",
    { relationship_heat: heat },
    entityId
  );

  const entity = await ctx.postgres.getEntity(entityId);
  console.log(
    `[reply-ingest] reply from ${from} → ${entity?.name ?? entityId} (heat=${heat.toFixed(2)})`
  );

  return { ok: true, entityId, message: `ingested reply for ${entity?.name ?? entityId}` };
}

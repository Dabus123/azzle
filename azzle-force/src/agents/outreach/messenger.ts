import { BaseAgent } from "../base.js";
import type { ForceContext } from "../../context.js";
import type { AgentIdentity } from "../../types.js";
import { SUBJECTS } from "../../events/subjects.js";
import { primaryEmail, primaryXHandle } from "../../delivery/contacts.js";
import { normalizeOutreachCopy } from "../../outreach/brand.js";

const ID: AgentIdentity = {
  id: "messenger",
  name: "Messenger",
  layer: "outreach",
  modelTier: "cheap",
  mission: "Deliver outreach through approved channels; track sent/opened/replied.",
  publishSubjects: [SUBJECTS.OUTREACH_SENT],
  subscribeSubjects: [SUBJECTS.OUTREACH_DRAFT_READY, SUBJECTS.MISSION_ASSIGNED],
};

export class Messenger extends BaseAgent {
  constructor(ctx: ForceContext) {
    super(ctx, ID);
  }

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.identity.id}] starting — ${this.identity.mission}`);

    for (const subject of this.identity.subscribeSubjects) {
      this.ctx.bus
        .subscribe(subject, (msg: import("../../types.js").NatsMessage) => this.onEvent(subject, msg))
        .catch((err: unknown) => {
          console.error(`[${this.identity.id}] subscribe error:`, err);
        });
    }

    if (!this.ctx.config.humanApproveOutreach) {
      await this.flushPendingOutreach();
    }

    await this.runLoop();
  }

  protected async onEvent(subject: string, msg: import("../../types.js").NatsMessage): Promise<void> {
    if (subject !== SUBJECTS.OUTREACH_DRAFT_READY || !msg.entity_id) return;

    const payload = msg.payload;
    const channel = String(payload.channel ?? "email");
    const subjectLine = payload.subject ? String(payload.subject) : undefined;
    const body = String(payload.body ?? "");
    const contentHash = String(payload.content_hash ?? "");

    if (this.ctx.config.humanApproveOutreach) {
      const pending = await this.ctx.postgres.getLatestOutreach(msg.entity_id, [
        "pending_approval",
      ]);
      if (pending) return;

      const preview = body.length > 0 ? body.slice(0, 200) : "(empty body)";
      console.log(
        `[${this.identity.id}] HUMAN_APPROVE_OUTREACH=true — draft queued for review:\n` +
          `  entity: ${msg.entity_id}\n` +
          `  channel: ${channel}\n` +
          `  preview: ${preview}${body.length > 200 ? "…" : ""}\n` +
          `  Run: npm run approve-outreach ${msg.entity_id}\n` +
          `  Or:  npm run outreach-preview ${msg.entity_id}`
      );
      await this.ctx.postgres.logOutreach(msg.entity_id, channel, "pending_approval", {
        contentHash,
        subject: subjectLine,
        body,
      });
      return;
    }

    try {
      await this.send(msg.entity_id, channel, subjectLine, body, contentHash);
    } catch (err) {
      let message = err instanceof Error ? err.message : String(err);
      if (message.includes("402")) {
        message +=
          " — X API requires a paid tier for DMs; set OUTREACH_DM_ENABLED=false in .env";
      }
      if (message.includes("not permitted")) {
        message += " — use email outreach; org X accounts often block cold DMs";
      }
      console.warn(`[${this.identity.id}] send failed for ${msg.entity_id}: ${message}`);
      await this.ctx.postgres.logOutreach(msg.entity_id, channel, "send_failed", {
        contentHash,
        subject: subjectLine,
        body,
      });
    }
  }

  protected async tick(): Promise<void> {
    if (!this.ctx.config.humanApproveOutreach) {
      await this.flushPendingOutreach();
    }
  }

  private async flushPendingOutreach(): Promise<void> {
    const pending = await this.ctx.postgres.entitiesWithLatestOutreachStatus("pending_approval");
    const drafts = await this.ctx.postgres.entitiesWithLatestOutreachStatus("draft");
    const ids = [...new Set([...pending, ...drafts])];
    if (ids.length === 0) return;

    let sent = 0;
    let skippedNoContact = 0;
    let failed = 0;

    for (const entityId of ids) {
      const entity = await this.ctx.postgres.getEntity(entityId);
      if (!entity) continue;

      const record = entity as Record<string, unknown>;
      if (!primaryEmail(record) && !primaryXHandle(record)) {
        skippedNoContact++;
        const draft = await this.ctx.postgres.getLatestOutreach(entityId);
        await this.ctx.postgres.logOutreach(entityId, String(draft?.channel ?? "email"), "skipped_no_contact", {
          contentHash: draft?.content_hash ? String(draft.content_hash) : undefined,
          subject: draft?.subject ? String(draft.subject) : undefined,
          body: draft?.body ? String(draft.body) : undefined,
        });
        continue;
      }

      try {
        await this.approveAndSend(entityId);
        sent++;
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[${this.identity.id}] send failed ${entityId}: ${message}`);
      }
    }

    console.log(
      `[${this.identity.id}] queue flush — ${sent} sent, ${skippedNoContact} no contact, ${failed} failed`
    );
  }

  async approveAndSend(entityId: string): Promise<void> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const draft = await this.ctx.postgres.getLatestOutreach(entityId);
    if (!draft) {
      throw new Error(`No pending outreach draft for entity ${entityId}`);
    }

    const channel = String(draft.channel ?? "email");
    const subject = draft.subject ? String(draft.subject) : undefined;
    const body = String(draft.body ?? "");
    const contentHash = draft.content_hash ? String(draft.content_hash) : undefined;

    if (!body.trim()) {
      throw new Error(
        `Draft body is empty for ${entityId} — re-run wave 3 personalizer or edit graph outreach_events`
      );
    }

    await this.send(entityId, channel, subject, body, contentHash);
  }

  private async send(
    entityId: string,
    channel: string,
    subject: string | undefined,
    body: string,
    contentHash?: string
  ): Promise<void> {
    const entity = await this.ctx.postgres.getEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const hash =
      contentHash ?? (await import("../../graph/writer.js")).GraphWriter.hashContent(body);

    const brand = this.ctx.config.outreachBrand;
    const normalizedBody = normalizeOutreachCopy(body, brand);

    const result = await this.ctx.delivery.send(
      channel,
      entity as Record<string, unknown>,
      subject ?? `AZZLE — agent task markets on Base`,
      normalizedBody
    );

    console.log(
      `[${this.identity.id}] sent via ${result.channel} → ${result.destination} (entity ${entityId})`
    );

    await this.ctx.postgres.logOutreach(entityId, result.channel, "sent", {
      contentHash: hash,
      subject,
      body: normalizedBody,
    });
    await this.ctx.bus.publish(
      SUBJECTS.OUTREACH_SENT,
      this.identity.id,
      { channel: result.channel, destination: result.destination, content_hash: hash },
      entityId
    );

    if (this.ctx.temporal) {
      await this.ctx.temporal.startFollowUp(entityId);
    }
  }
}

import { v4 as uuidv4 } from "uuid";
import type { NatsMessage } from "../types.js";
import { NatsMessageSchema } from "../types.js";

/** In-process event bus — no NATS server required */
export class LocalEventBus {
  private handlers = new Map<string, Array<(msg: NatsMessage) => Promise<void>>>();

  async connect(): Promise<void> {
    console.log("[lite] local event bus ready");
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }

  async publish(
    subject: string,
    agent: string,
    payload: Record<string, unknown>,
    entityId?: string
  ): Promise<NatsMessage> {
    const message = NatsMessageSchema.parse({
      event_id: uuidv4(),
      entity_id: entityId,
      agent,
      timestamp: new Date().toISOString(),
      payload,
    });

    const list = this.handlers.get(subject) ?? [];
    for (const handler of list) {
      try {
        await handler(message);
      } catch (err) {
        console.error(`[lite-bus] handler error on ${subject}:`, err);
      }
    }
    return message;
  }

  async subscribe(
    subject: string,
    handler: (msg: NatsMessage) => Promise<void>
  ): Promise<void> {
    if (!this.handlers.has(subject)) this.handlers.set(subject, []);
    this.handlers.get(subject)!.push(handler);
  }
}

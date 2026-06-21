import { connect, type NatsConnection, StringCodec } from "nats";
import { v4 as uuidv4 } from "uuid";
import type { NatsMessage } from "../types.js";
import { NatsMessageSchema } from "../types.js";

const sc = StringCodec();

export class EventBus {
  private conn: NatsConnection | null = null;

  constructor(private readonly natsUrl: string) {}

  async connect(): Promise<void> {
    if (this.conn) return;
    this.conn = await connect({ servers: this.natsUrl });
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
  }

  async publish(
    subject: string,
    agent: string,
    payload: Record<string, unknown>,
    entityId?: string
  ): Promise<NatsMessage> {
    await this.connect();
    const message: NatsMessage = NatsMessageSchema.parse({
      event_id: uuidv4(),
      entity_id: entityId,
      agent,
      timestamp: new Date().toISOString(),
      payload,
    });
    this.conn!.publish(subject, sc.encode(JSON.stringify(message)));
    return message;
  }

  async subscribe(
    subject: string,
    handler: (msg: NatsMessage) => Promise<void>
  ): Promise<void> {
    await this.connect();
    const sub = this.conn!.subscribe(subject);
    for await (const raw of sub) {
      try {
        const parsed = NatsMessageSchema.parse(JSON.parse(sc.decode(raw.data)));
        await handler(parsed);
      } catch (err) {
        console.error(`[nats] handler error on ${subject}:`, err);
      }
    }
  }
}

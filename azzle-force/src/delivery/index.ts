import type { EmailDeliveryConfig } from "./email.js";
import { EmailDelivery } from "./email.js";
import type { XDmConfig } from "./x-dm.js";
import { XDmDelivery } from "./x-dm.js";
import { primaryEmail, primaryXHandle } from "./contacts.js";

export interface OutreachDeliveryConfig {
  email: EmailDeliveryConfig;
  x: XDmConfig;
}

export class OutreachDelivery {
  readonly email: EmailDelivery;
  readonly xDm: XDmDelivery;

  constructor(config: OutreachDeliveryConfig) {
    this.email = new EmailDelivery(config.email);
    this.xDm = new XDmDelivery(config.x);
  }

  channelsReady(): { email: boolean; xDm: boolean } {
    return {
      email: this.email.isConfigured(),
      xDm: this.xDm.isConfigured(),
    };
  }

  async send(
    channel: string,
    entity: Record<string, unknown>,
    subject: string,
    body: string
  ): Promise<{ channel: string; destination: string }> {
    const normalized = channel === "twitter" || channel === "x" ? "dm" : channel;

    if (normalized === "email") {
      const to = primaryEmail(entity);
      if (!to) {
        throw new Error(
          `No email on entity "${entity.name}" — add email:you@example.com to contact_methods in the graph`
        );
      }
      const subj = subject || `AZZLE — agent task markets on Base`;
      await this.email.send(to, subj, body);
      return { channel: "email", destination: to };
    }

    if (normalized === "dm") {
      const handle = primaryXHandle(entity);
      if (!handle) {
        throw new Error(
          `No X/Twitter handle on entity "${entity.name}" — add x:handle or https://x.com/handle to contact_methods`
        );
      }
      try {
        await this.xDm.sendDmToHandle(handle, body);
        return { channel: "dm", destination: `@${handle}` };
      } catch (dmErr) {
        const to = primaryEmail(entity);
        if (to && this.email.isConfigured()) {
          const subj = subject || `AZZLE — agent task markets on Base`;
          await this.email.send(to, subj, body);
          return { channel: "email", destination: to };
        }
        throw dmErr;
      }
    }

    throw new Error(`Unsupported outreach channel: ${channel} (use email or dm)`);
  }
}

export { resolveContacts, primaryEmail, primaryXHandle, isReachableForOutreach, pickOutreachChannel } from "./contacts.js";

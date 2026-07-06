import type { EmailDeliveryConfig } from "./email.js";
import { EmailDelivery } from "./email.js";
import type { XDmConfig } from "./x-dm.js";
import { XDmDelivery } from "./x-dm.js";
import { primaryEmail, primaryXHandle, resolveSendChannel } from "./contacts.js";
import { isSendableEmail } from "./email-filter.js";

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
    body: string,
    opts?: { preferEmail?: boolean; dmEnabled?: boolean }
  ): Promise<{ channel: string; destination: string }> {
    const preferEmail = opts?.preferEmail ?? true;
    const dmEnabled = opts?.dmEnabled ?? true;
    const channels = this.channelsReady();
    const effective = resolveSendChannel(channel, entity, channels, dmEnabled, preferEmail);

    if (effective === "email") {
      const to = primaryEmail(entity);
      if (!to) {
        throw new Error(
          `No email on entity "${entity.name}" — add email:you@example.com to contact_methods in the graph`
        );
      }
      if (!isSendableEmail(to)) {
        throw new Error(`Blocked or invalid email on "${entity.name}": ${to}`);
      }
      const subj = subject || `Quick question about ${String(entity.name).split("/").pop() ?? "your repo"}`;
      await this.email.send(to, subj, body);
      return { channel: "email", destination: to };
    }

    if (effective === "dm") {
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
        if (to && isSendableEmail(to) && this.email.isConfigured()) {
          const subj = subject || `Quick question about ${String(entity.name).split("/").pop() ?? "your repo"}`;
          await this.email.send(to, subj, body);
          return { channel: "email", destination: to };
        }
        throw dmErr;
      }
    }

    throw new Error(
      `No deliverable channel for "${entity.name}" — need verified email: contact (cold X DMs disabled or unavailable)`
    );
  }
}

export {
  resolveContacts,
  primaryEmail,
  primaryXHandle,
  isReachableForOutreach,
  pickOutreachChannel,
  resolveSendChannel,
} from "./contacts.js";

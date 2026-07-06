import type { OutreachDeliveryConfig } from "./index.js";
import { OutreachDelivery } from "./index.js";
import { RedditDelivery } from "./reddit.js";
import { FarcasterDelivery } from "./farcaster.js";

function emailProviderFromEnv(): "resend" | "smtp" | "none" {
  const explicit = process.env.OUTREACH_EMAIL_PROVIDER?.toLowerCase();
  if (explicit === "resend" || explicit === "smtp") return explicit;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.SMTP_HOST) return "smtp";
  return "none";
}

export function createOutreachDelivery(): OutreachDelivery {
  const deliveryConfig: OutreachDeliveryConfig = {
    email: {
      provider: emailProviderFromEnv(),
      resendApiKey: process.env.RESEND_API_KEY ?? "",
      smtpHost: process.env.SMTP_HOST ?? "",
      smtpPort: Number(process.env.SMTP_PORT ?? "587"),
      smtpUser: process.env.SMTP_USER ?? "",
      smtpPass: process.env.SMTP_PASS ?? "",
      smtpSecure: process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
      fromEmail: process.env.OUTREACH_FROM_EMAIL ?? process.env.SMTP_FROM ?? "",
      fromName: process.env.OUTREACH_FROM_NAME ?? "AZZLE FORCE",
    },
    x: {
      apiKey: process.env.X_API_KEY ?? process.env.TWITTER_API_KEY ?? "",
      apiSecret: process.env.X_API_SECRET ?? process.env.TWITTER_API_SECRET ?? "",
      accessToken: process.env.X_ACCESS_TOKEN ?? process.env.TWITTER_ACCESS_TOKEN ?? "",
      accessSecret: process.env.X_ACCESS_SECRET ?? process.env.TWITTER_ACCESS_SECRET ?? "",
      oauth2AccessToken:
        process.env.X_OAUTH2_ACCESS_TOKEN ?? process.env.TWITTER_OAUTH2_ACCESS_TOKEN ?? "",
    },
  };

  return new OutreachDelivery(deliveryConfig);
}

export function createRedditDelivery(): RedditDelivery | null {
  const clientId = process.env.REDDIT_CLIENT_ID ?? "";
  const clientSecret = process.env.REDDIT_CLIENT_SECRET ?? "";
  if (!clientId || !clientSecret) return null;

  const delivery = new RedditDelivery({
    clientId,
    clientSecret,
    username: process.env.REDDIT_USERNAME,
    password: process.env.REDDIT_PASSWORD,
    refreshToken: process.env.REDDIT_REFRESH_TOKEN,
  });

  return delivery.isConfigured() ? delivery : null;
}

export function createFarcasterDelivery(): FarcasterDelivery | null {
  const apiKey = process.env.NEYNAR_API_KEY ?? "";
  const signerUuid = process.env.NEYNAR_SIGNER_UUID ?? "";
  if (!apiKey || !signerUuid) return null;

  const delivery = new FarcasterDelivery({ apiKey, signerUuid });
  return delivery.isConfigured() ? delivery : null;
}

export function logDeliveryStatus(
  delivery: OutreachDelivery,
  outreachDmEnabled = true,
  reddit: RedditDelivery | null = null,
  farcaster: FarcasterDelivery | null = null
): void {
  const ready = delivery.channelsReady();
  const dmActive = outreachDmEnabled && ready.xDm;
  const redditReady = reddit?.isConfigured() ?? false;
  const fcReady = farcaster?.isConfigured() ?? false;
  console.log(
    `[delivery] email=${ready.email ? "ready" : "not configured"} x_dm=${dmActive ? `ready (${delivery.xDm.authMode ?? "?"})` : "off"} reddit=${redditReady ? "ready" : "off"} farcaster=${fcReady ? "ready (autopost)" : "off"} outreach=${dmActive ? "email+x_dm" : "email-only"}`
  );
}

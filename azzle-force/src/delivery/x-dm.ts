import { TwitterApi, type TwitterApi as TwitterApiType } from "twitter-api-v2";

export interface XDmConfig {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
  oauth2AccessToken: string;
}

function formatXApiError(err: unknown): string {
  const e = err as { code?: number; data?: { detail?: string }; message?: string };
  const detail = e.data?.detail ?? e.message ?? String(err);
  if (e.code === 401) {
    return `${detail} — refresh X_OAUTH2_ACCESS_TOKEN or OAuth1 user tokens`;
  }
  if (e.code === 402 || detail.includes("does not have any credits")) {
    return `${detail} — add API credits in the X Developer Portal (developer.x.com), not a token format issue`;
  }
  if (/not permitted/i.test(detail)) {
    return `${detail} — recipient likely blocks cold DMs (common for org accounts); use email outreach or find email: in contact_methods`;
  }
  return detail;
}

function pickClient(config: XDmConfig): { client: TwitterApiType; mode: string } | null {
  const prefer = (process.env.X_DM_AUTH ?? "auto").toLowerCase();
  const hasOAuth1 =
    config.apiKey &&
    config.apiSecret &&
    config.accessToken &&
    config.accessSecret;
  const hasOAuth2 = Boolean(config.oauth2AccessToken);

  if (prefer === "oauth1" && hasOAuth1) {
    return {
      mode: "oauth1",
      client: new TwitterApi({
        appKey: config.apiKey,
        appSecret: config.apiSecret,
        accessToken: config.accessToken,
        accessSecret: config.accessSecret,
      }),
    };
  }

  if (prefer === "oauth2" && hasOAuth2) {
    return { mode: "oauth2", client: new TwitterApi(config.oauth2AccessToken) };
  }

  // auto: OAuth1 user context is more reliable for DMs when both are set
  if (hasOAuth1) {
    return {
      mode: "oauth1",
      client: new TwitterApi({
        appKey: config.apiKey,
        appSecret: config.apiSecret,
        accessToken: config.accessToken,
        accessSecret: config.accessSecret,
      }),
    };
  }

  if (hasOAuth2) {
    return { mode: "oauth2", client: new TwitterApi(config.oauth2AccessToken) };
  }

  return null;
}

export class XDmDelivery {
  private client: TwitterApiType | null = null;
  readonly authMode: string | null = null;

  constructor(private config: XDmConfig) {
    const picked = pickClient(config);
    if (picked) {
      this.client = picked.client;
      this.authMode = picked.mode;
    }
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /** Verify login + whether user lookup (required for DMs) works. */
  async probe(): Promise<{ ok: boolean; username?: string; dmLookupOk: boolean; message: string }> {
    if (!this.client) {
      return { ok: false, dmLookupOk: false, message: "X DM not configured" };
    }

    try {
      const me = await this.client.v2.me();
      const username = me.data.username;
      try {
        await this.client.v2.userByUsername("twitter");
        return {
          ok: true,
          username,
          dmLookupOk: true,
          message: `@${username} — auth OK, user lookup OK (DMs should work)`,
        };
      } catch (lookupErr) {
        return {
          ok: true,
          username,
          dmLookupOk: false,
          message: `@${username} — auth OK, but user lookup failed: ${formatXApiError(lookupErr)}`,
        };
      }
    } catch (err) {
      return { ok: false, dmLookupOk: false, message: formatXApiError(err) };
    }
  }

  async sendDmToHandle(handle: string, text: string): Promise<void> {
    if (!this.client) {
      throw new Error(
        "X/Twitter DM not configured — set X_OAUTH2_ACCESS_TOKEN or X API user tokens in .env"
      );
    }

    const clean = handle.replace(/^@/, "").toLowerCase();
    let userId: string | undefined;
    try {
      const user = await this.client.v2.userByUsername(clean);
      userId = user.data?.id;
    } catch (err) {
      throw new Error(`X user lookup failed for @${clean}: ${formatXApiError(err)}`);
    }

    if (!userId) {
      throw new Error(`X user not found: @${clean}`);
    }

    try {
      await this.client.v2.sendDmToParticipant(userId, { text });
    } catch (err) {
      throw new Error(`X DM send failed: ${formatXApiError(err)}`);
    }
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ForceContext } from "../context.js";

export interface ResendReceivedMeta {
  email_id: string;
  from: string;
  to: string[];
  subject?: string;
  message_id?: string;
}

export interface ResendReceivedEmail {
  text?: string | null;
  html?: string | null;
  subject?: string;
  from?: string;
  headers?: Record<string, string>;
}

/** Parse `Name <addr@domain.com>` or bare email. */
export function parseFromAddress(raw: string): string {
  const s = raw.trim();
  const angled = s.match(/<([^>]+@[^>]+)>/);
  if (angled) return angled[1].trim().toLowerCase();
  const bare = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
  return bare ? bare[0].toLowerCase() : s.toLowerCase();
}

export async function fetchReceivedEmail(
  emailId: string,
  apiKey: string
): Promise<ResendReceivedEmail> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend receiving API ${res.status}: ${errText.slice(0, 300)}`);
  }
  return (await res.json()) as ResendReceivedEmail;
}

/** Svix signature verification (Resend webhooks). */
export function verifySvixWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): Record<string, unknown> {
  const id = String(headers["svix-id"] ?? "");
  const timestamp = String(headers["svix-timestamp"] ?? "");
  const signatureHeader = String(headers["svix-signature"] ?? "");

  if (!id || !timestamp || !signatureHeader) {
    throw new Error("Missing Svix webhook headers");
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
    throw new Error("Webhook timestamp outside tolerance");
  }

  const key = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Buffer.from(key, "base64");
  const signed = `${id}.${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", keyBytes).update(signed).digest("base64");

  const valid = signatureHeader.split(" ").some((part) => {
    const comma = part.indexOf(",");
    if (comma < 0) return false;
    const version = part.slice(0, comma);
    const sig = part.slice(comma + 1);
    if (version !== "v1" || !sig) return false;
    try {
      return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });

  if (!valid) throw new Error("Invalid webhook signature");
  return JSON.parse(rawBody) as Record<string, unknown>;
}

export function extractReplyBody(email: ResendReceivedEmail): string {
  const raw = (email.text ?? "").trim();
  if (raw) return stripQuotedReply(raw);

  const html = email.html ?? "";
  if (html.startsWith("data:")) return stripQuotedReply(decodeDataUri(html));
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripQuotedReply(plain);
}

function decodeDataUri(uri: string): string {
  const match = uri.match(/^data:[^;]*;base64,(.+)$/);
  if (!match) return "";
  try {
    return Buffer.from(match[1], "base64").toString("utf8");
  } catch {
    return "";
  }
}

function stripQuotedReply(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^>/m.test(line)) break;
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^From:\s/i.test(line)) break;
    if (/^-----Original Message-----/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

export async function handleResendInboundWebhook(
  ctx: ForceContext,
  event: Record<string, unknown>
): Promise<{ ok: boolean; entityId?: string; message: string }> {
  const type = String(event.type ?? "");
  if (type !== "email.received") {
    return { ok: true, message: `ignored event type ${type}` };
  }

  const data = event.data as ResendReceivedMeta | undefined;
  if (!data?.email_id) {
    return { ok: false, message: "missing email_id in webhook payload" };
  }

  const apiKey = process.env.RESEND_API_KEY ?? "";
  if (!apiKey) {
    return { ok: false, message: "RESEND_API_KEY not set" };
  }

  const { ingestProspectReply } = await import("../outreach/reply-ingest.js");
  const full = await fetchReceivedEmail(data.email_id, apiKey);
  const from = parseFromAddress(String(full.from ?? data.from ?? ""));
  const body = extractReplyBody(full);
  if (!body) {
    return { ok: false, message: `empty reply body from ${from}` };
  }

  return ingestProspectReply(ctx, {
    fromEmail: from,
    body,
    subject: String(full.subject ?? data.subject ?? ""),
    source: "resend",
    messageId: data.message_id,
  });
}

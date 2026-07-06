/** Parse email / X handles from entity metadata and contact_methods */

import { isSendableEmail } from "./email-filter.js";

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const X_URL_RE = /(?:https?:\/\/)?(?:www\.)?(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:\/)?$/i;

export interface ResolvedContacts {
  emails: string[];
  xHandles: string[];
  preferredChannel: "email" | "dm" | null;
}

function collectStrings(entity: Record<string, unknown>): string[] {
  const meta = (entity.metadata as Record<string, unknown>) ?? {};
  const out: string[] = [];

  if (Array.isArray(meta.contact_methods)) {
    out.push(...meta.contact_methods.map(String));
  }
  if (meta.email) out.push(String(meta.email));
  if (meta.owner) out.push(`https://github.com/${meta.owner}`);
  if (meta.url) out.push(String(meta.url));
  if (meta.repo) out.push(String(meta.repo));

  return out;
}

function parseXHandle(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  const prefixed = s.match(/^(?:x|twitter):@?([a-zA-Z0-9_]{1,15})$/i);
  if (prefixed) return prefixed[1].toLowerCase();

  if (s.startsWith("@") && s.length > 1) return s.slice(1).toLowerCase();

  const urlMatch = X_URL_RE.exec(s);
  if (urlMatch) return urlMatch[1].toLowerCase();

  return null;
}

function parseEmail(raw: string): string | null {
  const s = raw.trim();
  const prefixed = s.match(/^email:([^\s]+)$/i);
  if (prefixed) return prefixed[1].toLowerCase();

  const match = EMAIL_RE.exec(s);
  const email = match ? match[0].toLowerCase() : null;
  if (email && !isSendableEmail(email)) return null;
  return email;
}

export function resolveContacts(entity: Record<string, unknown>): ResolvedContacts {
  const emails: string[] = [];
  const xHandles: string[] = [];
  const seenEmail = new Set<string>();
  const seenX = new Set<string>();

  for (const raw of collectStrings(entity)) {
    const email = parseEmail(raw);
    if (email && !seenEmail.has(email)) {
      seenEmail.add(email);
      emails.push(email);
    }
    const handle = parseXHandle(raw);
    if (handle && !seenX.has(handle)) {
      seenX.add(handle);
      xHandles.push(handle);
    }
  }

  let preferredChannel: ResolvedContacts["preferredChannel"] = null;
  if (emails.length > 0) preferredChannel = "email";
  else if (xHandles.length > 0) preferredChannel = "dm";

  return { emails, xHandles, preferredChannel };
}

export function isReachableForOutreach(
  entity: Record<string, unknown>,
  channels: { email: boolean; xDm: boolean },
  dmEnabled = true,
  preferEmail = true
): boolean {
  const contacts = resolveContacts(entity);
  if (channels.email && contacts.emails.length > 0) return true;
  if (preferEmail) return false;
  if (dmEnabled && channels.xDm && contacts.xHandles.length > 0) return true;
  return false;
}

/** Prefer email when available — DMs need valid X OAuth and rarely convert cold. */
export function pickOutreachChannel(
  entity: Record<string, unknown>,
  channels: { email: boolean; xDm: boolean },
  dmEnabled = true,
  preferEmail = true
): "email" | "dm" | null {
  const contacts = resolveContacts(entity);
  if (channels.email && contacts.emails.length > 0) return "email";
  if (preferEmail) return null;
  if (dmEnabled && channels.xDm && contacts.xHandles.length > 0) return "dm";
  return null;
}

/** Resolve channel for send — always email when available regardless of draft channel. */
export function resolveSendChannel(
  requestedChannel: string,
  entity: Record<string, unknown>,
  channels: { email: boolean; xDm: boolean },
  dmEnabled: boolean,
  preferEmail: boolean
): "email" | "dm" | null {
  const contacts = resolveContacts(entity);
  const normalized = requestedChannel === "twitter" || requestedChannel === "x" ? "dm" : requestedChannel;

  if (channels.email && contacts.emails.length > 0) return "email";
  if (preferEmail) return null;
  if (normalized === "dm" && dmEnabled && channels.xDm && contacts.xHandles.length > 0) return "dm";
  return null;
}

export function primaryEmail(entity: Record<string, unknown>): string | null {
  return resolveContacts(entity).emails[0] ?? null;
}

export function primaryXHandle(entity: Record<string, unknown>): string | null {
  return resolveContacts(entity).xHandles[0] ?? null;
}

import type { PostgresStore } from "../graph/postgres.js";
import { primaryEmail, primaryXHandle } from "../delivery/contacts.js";

/** Latest outreach in these states reserves the destination for that entity. */
const RESERVING_STATUSES = ["sent", "draft", "pending_approval"] as const;

export interface BlockedDestinations {
  emails: Set<string>;
  xHandles: Set<string>;
}

/** Destinations already sent to or in the outreach pipeline (another entity). */
export async function loadBlockedDestinations(
  store: PostgresStore,
  excludeEntityId?: string
): Promise<BlockedDestinations> {
  const emails = new Set<string>();
  const xHandles = new Set<string>();
  const seenEntities = new Set<string>();

  for (const status of RESERVING_STATUSES) {
    const ids = await store.entitiesWithLatestOutreachStatus(status);
    for (const id of ids) {
      if (id === excludeEntityId || seenEntities.has(id)) continue;
      seenEntities.add(id);

      const entity = await store.getEntity(id);
      if (!entity) continue;

      const record = entity as Record<string, unknown>;
      const email = primaryEmail(record);
      const handle = primaryXHandle(record);
      if (email) emails.add(email.toLowerCase());
      if (handle) xHandles.add(handle.toLowerCase());
    }
  }

  return { emails, xHandles };
}

/** Returns the blocked destination string if this entity would duplicate outreach. */
export function duplicateDestination(
  entity: Record<string, unknown>,
  blocked: BlockedDestinations
): string | null {
  const email = primaryEmail(entity);
  if (email && blocked.emails.has(email.toLowerCase())) return email;

  const handle = primaryXHandle(entity);
  if (handle && blocked.xHandles.has(handle.toLowerCase())) return `@${handle}`;

  return null;
}

export function reserveDestination(
  entity: Record<string, unknown>,
  blocked: BlockedDestinations
): void {
  const email = primaryEmail(entity);
  if (email) blocked.emails.add(email.toLowerCase());
  const handle = primaryXHandle(entity);
  if (handle) blocked.xHandles.add(handle.toLowerCase());
}

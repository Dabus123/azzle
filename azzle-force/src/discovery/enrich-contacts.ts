import type { ForceContext } from "../context.js";
import { isSendableEmail } from "../delivery/email-filter.js";
import { hasReachableContact, resolveOwnerFromMetadata } from "./contact-utils.js";

export { hasReachableContact, resolveOwnerFromMetadata } from "./contact-utils.js";

/** Add GitHub email / X when available. Returns true only if a sendable contact was added. */
export async function enrichEntityContacts(
  ctx: ForceContext,
  entityId: string,
  agentId: string
): Promise<boolean> {
  const entity = await ctx.postgres.getEntity(entityId);
  if (!entity) return false;

  const meta = entity.metadata as Record<string, unknown>;
  if (meta.contact_enrichment_attempted === true) return false;
  if (hasReachableContact(meta)) return false;

  const { owner, repo } = resolveOwnerFromMetadata(meta, String(entity.name));
  if (!owner) return false;

  const existing = Array.isArray(meta.contact_methods)
    ? [...(meta.contact_methods as string[])]
    : [];
  const contacts: string[] = [...existing];
  const seen = new Set(contacts);
  let addedReachable = false;

  const add = (c: string, reachable = false) => {
    if (reachable && c.startsWith("email:")) {
      const addr = c.slice(6);
      if (!isSendableEmail(addr)) return;
    }
    if (!seen.has(c)) {
      seen.add(c);
      contacts.push(c);
      if (reachable) addedReachable = true;
    }
  };

  if (meta.url) add(String(meta.url));
  add(`https://github.com/${owner}`);
  if (repo) add(repo);

  const ghUser = await ctx.github.getUser(owner);
    if (ghUser?.email && isSendableEmail(ghUser.email)) add(`email:${ghUser.email}`, true);
  if (ghUser?.twitter) add(`x:${ghUser.twitter}`, true);
  if (ghUser?.blog) add(String(ghUser.blog));

  if (!addedReachable) {
    const repoHint =
      repo ??
      (typeof meta.highlighted_repo === "string" ? meta.highlighted_repo : null) ??
      (typeof meta.source_repo === "string" ? meta.source_repo : null) ??
      (String(entity.name).includes("/") ? String(entity.name) : null);
    const commitEmail = await ctx.github.getCommitAuthorEmail(owner, repoHint);
    if (commitEmail && isSendableEmail(commitEmail)) add(`email:${commitEmail}`, true);
  }

  if (meta.poster) add(`base:${meta.poster}`);

  const metadataPatch: Record<string, unknown> = {
    contact_methods: contacts,
    contact_enrichment_attempted: true,
  };
  if (!meta.owner) metadataPatch.owner = owner;
  if (repo && !meta.repo) metadataPatch.repo = repo;

  await ctx.writer.write({
    agent: agentId,
    type: String(entity.type),
    name: String(entity.name),
    entityId,
    metadata: metadataPatch,
    embedText: addedReachable
      ? `${entity.name} contacts ${contacts.join(" ")}`
      : undefined,
    embedCollection: addedReachable ? "entities" : undefined,
  });

  return addedReachable;
}

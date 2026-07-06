const GITHUB_REPO_RE = /github\.com\/([^/]+)\/([^/?#]+)/i;

import { isSendableEmail } from "../delivery/email-filter.js";

export function hasReachableContact(metadata: Record<string, unknown>): boolean {
  const cm = metadata.contact_methods;
  if (!Array.isArray(cm)) return false;
  for (const c of cm) {
    const s = String(c);
    if (/^x:/i.test(s)) return true;
    const emailMatch = /^email:([^\s]+)$/i.exec(s.trim());
    if (emailMatch && isSendableEmail(emailMatch[1])) return true;
  }
  return false;
}

/** Resolve GitHub owner (and optional repo URL) from entity metadata or name. */
export function resolveOwnerFromMetadata(
  meta: Record<string, unknown>,
  entityName?: string
): { owner: string | null; repo: string | null } {
  if (meta.owner && typeof meta.owner === "string") {
    const repo =
      typeof meta.repo === "string"
        ? meta.repo
        : typeof meta.url === "string" && meta.url.includes("github.com")
          ? meta.url
          : null;
    return { owner: meta.owner, repo };
  }

  for (const field of ["highlighted_repo", "source_repo", "repo", "url"] as const) {
    const val = meta[field];
    if (typeof val !== "string") continue;
    const fullNameMatch = /^([^/]+)\/([^/]+)$/.exec(val.trim());
    if (fullNameMatch && !val.includes("github.com")) {
      const [, owner, repoName] = fullNameMatch;
      return { owner, repo: `https://github.com/${owner}/${repoName}` };
    }
    const urlMatch = GITHUB_REPO_RE.exec(val);
    if (urlMatch) {
      return {
        owner: urlMatch[1],
        repo: `https://github.com/${urlMatch[1]}/${urlMatch[2]}`,
      };
    }
  }

  if (entityName?.includes("/")) {
    const [owner, repoName] = entityName.split("/");
    if (owner && repoName) {
      return { owner, repo: `https://github.com/${owner}/${repoName}` };
    }
  }

  return { owner: null, repo: null };
}

export function entityNeedsContactEnrichment(
  entity: { name?: string; metadata?: Record<string, unknown> }
): boolean {
  const meta = entity.metadata ?? {};
  if (meta.contact_enrichment_attempted === true) return false;
  if (hasReachableContact(meta)) return false;
  const { owner } = resolveOwnerFromMetadata(meta, entity.name);
  return owner != null;
}

export interface FunnelStats {
  total: number;
  withOwner: number;
  scored: number;
  aboveThreshold: number;
  withReachableContact: number;
  contactableAboveThreshold: number;
  enrichmentAttempted: number;
  awaitingOutreach: number;
  outreach: {
    total: number;
    sent: number;
    draft: number;
    send_failed: number;
    skipped_no_contact: number;
    pending_approval: number;
    skipped_duplicate_contact: number;
  };
}

export function computeFunnelStats(
  entities: Array<{ id: string; name?: string; metadata?: Record<string, unknown> }>,
  scores: Array<{ entity_id: string; score_type: string; value: number }>,
  outreachEvents: Array<{ entity_id: string; status: string; created_at?: string }>,
  threshold: number,
  scoreType = "azzle_probability"
): FunnelStats {
  const scoreMap = new Map<string, number>();
  for (const s of scores) {
    if (s.score_type === scoreType) scoreMap.set(s.entity_id, s.value);
  }

  let withOwner = 0;
  let scored = 0;
  let aboveThreshold = 0;
  let withReachableContact = 0;
  let contactableAboveThreshold = 0;
  let enrichmentAttempted = 0;

  for (const e of entities) {
    const meta = e.metadata ?? {};
    if (resolveOwnerFromMetadata(meta, e.name).owner) withOwner++;
    const score = scoreMap.get(e.id);
    if (score != null) scored++;
    if ((score ?? 0) >= threshold) aboveThreshold++;
    if (hasReachableContact(meta)) withReachableContact++;
    if ((score ?? 0) >= threshold && hasReachableContact(meta)) contactableAboveThreshold++;
    if (meta.contact_enrichment_attempted === true) enrichmentAttempted++;
  }

  const latestOutreach = new Map<string, { status: string; created_at: string }>();
  for (const o of outreachEvents) {
    const created = o.created_at ?? "";
    const prev = latestOutreach.get(o.entity_id);
    if (!prev || created > prev.created_at) {
      latestOutreach.set(o.entity_id, { status: o.status, created_at: created });
    }
  }

  const outreachCounts = {
    total: latestOutreach.size,
    sent: 0,
    draft: 0,
    send_failed: 0,
    skipped_no_contact: 0,
    pending_approval: 0,
    skipped_duplicate_contact: 0,
  };
  for (const { status } of latestOutreach.values()) {
    if (status in outreachCounts) {
      outreachCounts[status as keyof typeof outreachCounts]++;
    }
  }

  const handledOutreach = new Set([
    "sent",
    "send_failed",
    "skipped_no_contact",
    "skipped_duplicate_contact",
    "draft",
    "pending_approval",
  ]);
  let awaitingOutreach = 0;
  for (const e of entities) {
    const score = scoreMap.get(e.id) ?? 0;
    if (score < threshold || !hasReachableContact(e.metadata ?? {})) continue;
    const latest = latestOutreach.get(e.id);
    if (!latest || !handledOutreach.has(latest.status)) awaitingOutreach++;
  }

  return {
    total: entities.length,
    withOwner,
    scored,
    aboveThreshold,
    withReachableContact,
    contactableAboveThreshold,
    enrichmentAttempted,
    awaitingOutreach,
    outreach: outreachCounts,
  };
}

export function formatFunnelReport(stats: FunnelStats, threshold: number): string {
  const gap = stats.aboveThreshold - stats.contactableAboveThreshold;
  const lines = [
    "=== AZZLE FORCE FUNNEL ===",
    `Total entities:              ${stats.total}`,
    `With GitHub owner:           ${stats.withOwner}`,
    `Scored (azzle_probability):  ${stats.scored}`,
    `Score >= ${threshold}:              ${stats.aboveThreshold}`,
    `Reachable (email or X):      ${stats.withReachableContact}`,
    `Qualified + contactable:     ${stats.contactableAboveThreshold}`,
    `Enrichment attempted:        ${stats.enrichmentAttempted}`,
    "",
    "=== OUTREACH ===",
    `Awaiting draft/send:         ${stats.awaitingOutreach}`,
    `Entities touched:            ${stats.outreach.total}`,
    `  sent:                      ${stats.outreach.sent}`,
    `  draft:                     ${stats.outreach.draft}`,
    `  send_failed:               ${stats.outreach.send_failed}`,
    `  skipped_no_contact:        ${stats.outreach.skipped_no_contact}`,
    `  skipped_duplicate_contact: ${stats.outreach.skipped_duplicate_contact}`,
    `  pending_approval:          ${stats.outreach.pending_approval}`,
    "",
    "=== GAPS ===",
    `High-score, no contact:      ${gap}`,
    `Unscored backlog:            ${stats.total - stats.scored}`,
    `Owner, not enriched:         ${Math.max(0, stats.withOwner - stats.enrichmentAttempted)}`,
  ];
  return lines.join("\n");
}

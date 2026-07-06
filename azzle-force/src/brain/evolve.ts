import type { ForceContext } from "../context.js";
import { loadPlaybook, savePlaybook, upsertPlaybookEntry } from "./playbook.js";

interface VariantStats {
  content_hash: string;
  sent: number;
  replied: number;
  converted: number;
}

export async function aggregateOutreachOutcomes(ctx: ForceContext): Promise<VariantStats[]> {
  const events = await ctx.postgres.listRecentOutreach(500);
  const byHash = new Map<string, VariantStats>();

  for (const row of events) {
    const hash = String(row.content_hash ?? "");
    if (!hash) continue;
    const stat = byHash.get(hash) ?? { content_hash: hash, sent: 0, replied: 0, converted: 0 };
    const status = String(row.status);
    if (status === "sent") stat.sent++;
    if (status === "replied") stat.replied++;
    if (status === "converted") stat.converted++;
    byHash.set(hash, stat);
  }
  return [...byHash.values()].filter((s) => s.sent >= 2);
}

export async function evolvePlaybooks(ctx: ForceContext): Promise<string[]> {
  const stats = await aggregateOutreachOutcomes(ctx);
  if (stats.length < 2) return ["insufficient data"];

  const ranked = stats
    .map((s) => ({
      ...s,
      reply_rate: s.sent > 0 ? s.replied / s.sent : 0,
    }))
    .sort((a, b) => b.reply_rate - a.reply_rate);

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  const notes: string[] = [];

  if (best.reply_rate > worst.reply_rate + 0.05) {
    const extra = [
      "Prioritize hooks that mirror top-performing outreach:",
      `- Reply rate ${(best.reply_rate * 100).toFixed(0)}% vs ${(worst.reply_rate * 100).toFixed(0)}% baseline.`,
      "- Lead with concrete Base/USDC escrow outcome, not protocol jargon.",
      "- One CTA only: reply, /post, or book 15m.",
    ].join("\n");

    for (const agentId of ["personalizer", "sequencer", "closer", "objection-handler"]) {
      upsertPlaybookEntry(agentId, extra, `evolved-${Date.now()}`, {
        wins: Math.round(best.replied),
        attempts: Math.round(best.sent),
      });
    }
    notes.push(`updated playbooks from hash ${best.content_hash.slice(0, 10)}…`);
  }

  const file = loadPlaybook();
  file.version += 1;
  savePlaybook(file);

  await ctx.postgres.logAudit("prompt-evolver", "playbook_evolved", {
    best_rate: best.reply_rate,
    worst_rate: worst.reply_rate,
    variants: ranked.length,
  });

  return notes;
}

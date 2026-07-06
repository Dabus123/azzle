/** Temporal relationship heat + score decay for prospect prioritization. */

export interface OutreachTouch {
  status: string;
  created_at?: string | Date;
  sent_at?: string | Date | null;
}

export interface EntitySignal {
  type: string;
  strength: number;
  at: Date;
}

const MS_DAY = 86_400_000;

export function decayScore(value: number, computedAt: Date, halfLifeDays: number, now = new Date()): number {
  if (halfLifeDays <= 0) return value;
  const ageMs = now.getTime() - computedAt.getTime();
  const ageDays = ageMs / MS_DAY;
  const factor = Math.pow(0.5, ageDays / halfLifeDays);
  return Math.max(0, Math.min(1, value * factor));
}

export function computeRelationshipHeat(input: {
  baseFit: number;
  signals: EntitySignal[];
  outreach: OutreachTouch[];
  now?: Date;
}): { heat: number; reason: string } {
  const now = input.now ?? new Date();
  // baseFit alone must reach warm band for high-fit prospects (0.75 fit → ~0.41).
  let heat = input.baseFit * 0.55;
  const parts: string[] = [`base=${input.baseFit.toFixed(2)}`];

  for (const sig of input.signals) {
    const ageDays = (now.getTime() - sig.at.getTime()) / MS_DAY;
    const fresh = Math.max(0, 1 - ageDays / 7);
    const boost = sig.strength * fresh * 0.25;
    if (boost > 0.01) {
      heat += boost;
      parts.push(`${sig.type}+${boost.toFixed(2)}`);
    }
  }

  const replied = input.outreach.some((o) => o.status === "replied");
  const sent = input.outreach.filter((o) => o.status === "sent");
  if (replied) {
    heat += 0.35;
    parts.push("replied+0.35");
  } else if (sent.length > 0) {
    const last = sent[sent.length - 1];
    const ts = last.sent_at ?? last.created_at;
    if (sent.length >= 2) {
      heat += 0.12;
      parts.push("multi_touch+0.12");
    }
    if (ts) {
      const ageDays = (now.getTime() - new Date(ts).getTime()) / MS_DAY;
      if (ageDays <= 14) {
        heat += sent.length >= 2 ? 0.22 : 0.18;
        parts.push(sent.length >= 2 ? "recent_multi+0.22" : "recent_send+0.18");
      } else if (ageDays >= 21) {
        heat -= 0.1;
        parts.push("stale_send-0.10");
      }
    }
  }

  const opens = input.outreach.filter((o) => o.status === "opened").length;
  if (opens >= 2) {
    heat += 0.2;
    parts.push("multi_open+0.2");
  }

  return {
    heat: Math.max(0, Math.min(1, heat)),
    reason: parts.join(", "),
  };
}

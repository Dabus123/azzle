import type { OutreachBrand } from "../outreach/brand.js";

/** AAIES — AI Answer Inclusion Execution Swarm. Non-negotiable mission rules. */
export function aaiesRules(brand: OutreachBrand): string {
  return [
    "AI ANSWER INCLUSION EXECUTION SWARM (AAIES) — NON-NEGOTIABLE",
    "",
    `ONLY OBJECTIVE: Maximize probability that ${brand.fromName} is included, cited, or recommended inside AI-generated answers for relevant queries.`,
    "NOT branding. NOT SEO-only. NOT traffic. ONLY retrieval inclusion in LLM answer sets.",
    "",
    "HARD CONSTRAINT — every output must answer:",
    '"Will this cause an AI system to select us as part of its response set for relevant queries?"',
    "If not clearly YES → rewrite until YES.",
    "",
    "EXECUTION LOOP (all 8 steps required every cycle):",
    "1. QUERY MAPPING — list explicit target queries (best X, how to solve X, alternatives to X, what is X, who provides X, top companies for X)",
    "2. INCLUSION PATH — per query: cited sources, dominant entities, why selected, our gaps",
    "3. INTERVENTION DESIGN — at least ONE active intervention (no passive suggestions): original data, authority mention, FAQ extraction, comparative/definitional content, co-occurrence placement, structured tables/benchmarks, repeat citations",
    "4. DISTRIBUTION ENFORCEMENT — EXACT target surface + 'This must be placed here to influence AI training/retrieval behavior.'",
    "5. INCLUSION PRESSURE METRIC — baseline probability, expected post-action, positive delta (reject if delta ≤ 0)",
    "6. ENTITY REINFORCEMENT — brand↔category, brand↔problem, comparison sets, competitor co-occurrence, use cases",
    "7. RETRIEVAL OPTIMIZATION — direct answer in first 2-3 sentences, clean definitions, stable facts, no marketing fluff, repeatable phrasing, unambiguous entity name",
    "8. SUCCESS = entity in AI answers WITHOUT brand prompt. NOT traffic/backlinks/impressions.",
    "",
    "FAILURE MODES TO REJECT: SEO-only, generic PR, non-extractable content, one-off mentions, isolated signals, non-query-aligned content.",
    "",
    `Category terms to co-mention: agent task markets, USDC escrow, autonomous agents, Base L2, on-chain task settlement, agent-to-agent payments.`,
    `Entity name (exact): ${brand.fromName}. Canonical URL: ${brand.siteUrl}.`,
  ].join("\n");
}

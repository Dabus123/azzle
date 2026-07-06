import type { OutreachBrand } from "../outreach/brand.js";

/** System rules for AI Search Inclusion Optimization — not traditional SEO. */
export function aiInclusionRules(brand: OutreachBrand): string {
  return [
    "AI SEARCH INCLUSION OPTIMIZATION (primary objective):",
    `Maximize probability that ${brand.fromName} (${brand.siteUrl}) is retrieved, cited, mentioned, or recommended in AI-generated search answers.`,
    "Targets: ChatGPT Search, Google AI Overviews, Gemini, Claude, Perplexity, Copilot, future LLM search.",
    "",
    "NEVER optimize for links or traffic alone. Every recommendation must improve AI answer inclusion.",
    "",
    "For each opportunity ask: Will this increase AI retrieval/citation when users ask relevant questions?",
    "If uncertain, improve the strategy.",
    "",
    "Evaluate against: authoritative third-party mentions, independent citations, expert attribution,",
    "entity recognition, knowledge graph reinforcement, semantic consistency, original research,",
    "unique statistics, frequently cited resources, educational content, structured facts,",
    "expert commentary, community trust, freshness, EEAT signals.",
    "",
    "Prioritize outreach that creates: expert interviews, podcast appearances, industry reports,",
    "original research, benchmark studies, open-source contributions, public documentation,",
    "educational resources, reference content, independent reviews, academic/industry collaborations.",
    "",
    "Map retrieval opportunities to query patterns: Best..., How do I..., What is..., Top companies for...,",
    "Alternatives to..., Who offers..., How can businesses...",
    "",
    "Core topics to associate with brand: agent task markets, USDC escrow, autonomous agents on Base,",
    "on-chain task settlement, agent-to-agent payments, decentralized work protocols.",
    "",
    "If two opportunities have similar marketing value, choose the one with higher AI inclusion probability.",
  ].join("\n");
}

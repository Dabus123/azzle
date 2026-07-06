import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

/** Repo-root `.agents/product-marketing.md` (parent of azzle-force/). */
const DEFAULT_PATH = resolve(__dir, "../../../.agents/product-marketing.md");

const PROMPT_SECTIONS = [
  "Product Overview",
  "Brand Voice",
  "Customer Language",
  "Differentiation",
  "Objections",
  "Messaging Pillars",
  "Upcoming: AZZLE Union Staking",
];

let cachedRaw: string | null | undefined;

export function loadProductMarketingRaw(): string | null {
  if (cachedRaw !== undefined) return cachedRaw;

  const candidates = [
    process.env.AZZLE_PRODUCT_MARKETING_PATH,
    DEFAULT_PATH,
    resolve(process.cwd(), "../.agents/product-marketing.md"),
    resolve(process.cwd(), ".agents/product-marketing.md"),
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (existsSync(path)) {
      cachedRaw = readFileSync(path, "utf8");
      return cachedRaw;
    }
  }
  cachedRaw = null;
  return null;
}

function extractSections(md: string, headings: string[]): string {
  const parts: string[] = [];
  for (const heading of headings) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = md.match(re);
    if (match?.[1]?.trim()) {
      parts.push(`## ${heading}\n${match[1].trim()}`);
    }
  }
  return parts.join("\n\n");
}

const FALLBACK =
  "AZZLE — agents post, claim, prove, and get paid on Base. Labor Organism: USDC escrow, agent task markets, onchain reputation. Access fee: $5 USDC + 1,000 $AZL. Voice: bold, agent-native, anti-middleman. azzle.org";

/** Condensed positioning block for LLM system prompts. */
export function productMarketingPromptBlock(maxChars = 6500): string {
  const raw = loadProductMarketingRaw();
  if (!raw) {
    return `PRODUCT MARKETING CONTEXT:\n${FALLBACK}`;
  }

  let body = extractSections(raw, PROMPT_SECTIONS);
  if (!body.trim()) body = raw;

  if (body.length > maxChars) {
    body = `${body.slice(0, maxChars - 24).trimEnd()}\n\n[context truncated]`;
  }

  return [
    "PRODUCT MARKETING CONTEXT — follow voice, positioning, terminology, and economics exactly:",
    body,
  ].join("\n\n");
}

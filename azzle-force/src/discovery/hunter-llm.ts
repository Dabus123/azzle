import { HunterOutputSchema, type EntityType, type HunterOutput } from "../types.js";

export interface HunterGithubFacts {
  full_name?: string;
  owner?: string;
  html_url?: string;
  description?: string | null;
  topics?: string[];
  stargazers_count?: number;
  search_query?: string;
}

/** Heuristic fallback when the hunter LLM call fails. */
export function heuristicHunterOutput(
  facts: HunterGithubFacts,
  defaultType: EntityType,
  defaultName?: string
): HunterOutput {
  const name = facts.full_name ?? defaultName ?? facts.owner ?? "unknown";
  const stars = facts.stargazers_count ?? 0;
  return HunterOutputSchema.parse({
    name,
    type: defaultType,
    owner: facts.owner,
    repo: facts.html_url,
    skills: facts.topics ?? [],
    description: facts.description ?? undefined,
    azzle_fit: Math.min(stars / 1000, 1),
    url: facts.html_url,
  });
}

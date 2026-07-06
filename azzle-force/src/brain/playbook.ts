import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PlaybookEntry {
  agent_id: string;
  system_extra: string;
  variant_id: string;
  updated_at: string;
  wins: number;
  attempts: number;
}

export interface PlaybookFile {
  version: number;
  entries: PlaybookEntry[];
}

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dir, "../../config/brain-playbooks.json");

export function playbookPath(): string {
  return process.env.AZZLE_BRAIN_PLAYBOOKS ?? DEFAULT_PATH;
}

export function loadPlaybook(): PlaybookFile {
  const path = playbookPath();
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PlaybookFile;
  } catch {
    return { version: 1, entries: [] };
  }
}

export function savePlaybook(file: PlaybookFile): void {
  writeFileSync(playbookPath(), JSON.stringify(file, null, 2), "utf8");
}

export function getAgentPromptExtra(agentId: string): string {
  const file = loadPlaybook();
  const entry = file.entries.find((e) => e.agent_id === agentId);
  return entry?.system_extra?.trim() ?? "";
}

export function upsertPlaybookEntry(
  agentId: string,
  systemExtra: string,
  variantId: string,
  delta: { wins?: number; attempts?: number }
): void {
  const file = loadPlaybook();
  let entry = file.entries.find((e) => e.agent_id === agentId);
  if (!entry) {
    entry = {
      agent_id: agentId,
      system_extra: systemExtra,
      variant_id: variantId,
      updated_at: new Date().toISOString(),
      wins: 0,
      attempts: 0,
    };
    file.entries.push(entry);
  }
  entry.system_extra = systemExtra;
  entry.variant_id = variantId;
  entry.updated_at = new Date().toISOString();
  entry.wins += delta.wins ?? 0;
  entry.attempts += delta.attempts ?? 0;
  savePlaybook(file);
}

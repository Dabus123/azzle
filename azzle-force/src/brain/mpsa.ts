import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type MPSALayerId = "O" | "P" | "C" | "G" | "S";

export interface MPSALayer {
  id: MPSALayerId;
  title: string;
  content: string;
  source?: string;
}

export interface RealityMode {
  id: string;
  name: string;
  description: string;
  o_layer: string;
  p_layer: string;
  task_hint?: string;
}

export interface AgentStackOverride {
  reality_mode?: string;
  c_layer?: string;
  g_layer?: string;
}

export interface ResolvedMPSAStack {
  agent_id: string;
  reality_mode: string;
  reality_name: string;
  layers: MPSALayer[];
  execution_order: MPSALayerId[];
}

export interface MPSAConfig {
  version: number;
  shared: {
    default_c_layer: string;
    default_g_layer: string;
    shared_s_layer: string;
    execution_order: MPSALayerId[];
  };
  reality_modes: RealityMode[];
  agent_stacks: Record<string, AgentStackOverride>;
  default_reality_mode: string;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const MPSA_ROOT = resolve(__dir, "../../config/mpsa");

const LAYER_TITLES: Record<MPSALayerId, string> = {
  O: "Ontology Layer (O-Layer)",
  P: "Physics / Rule Layer (P-Layer)",
  C: "Cognition Layer (C-Layer)",
  G: "Objective Layer (G-Layer)",
  S: "Stability Layer (S-Layer)",
};

let cached: MPSAConfig | null = null;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function mpsaConfigPath(): string {
  return process.env.AZZLE_MPSA_CONFIG ?? MPSA_ROOT;
}

export function loadMPSAConfig(force = false): MPSAConfig {
  if (cached && !force) return cached;

  const root = mpsaConfigPath();
  const shared = readJson<{
    default_c_layer: string;
    default_g_layer: string;
    shared_s_layer: string;
    execution_order: MPSALayerId[];
  }>(resolve(root, "shared-layers.json"));

  const modesFile = readJson<{ modes: RealityMode[] }>(resolve(root, "reality-modes.json"));
  const stacksFile = readJson<{
    default_reality_mode: string;
    agents: Record<string, AgentStackOverride>;
  }>(resolve(root, "agent-stacks.json"));

  cached = {
    version: 1,
    shared,
    reality_modes: modesFile.modes,
    agent_stacks: stacksFile.agents,
    default_reality_mode: stacksFile.default_reality_mode,
  };
  return cached;
}

export function getRealityMode(modeId: string): RealityMode | undefined {
  return loadMPSAConfig().reality_modes.find((m) => m.id === modeId);
}

export function resolveAgentStack(agentId: string): ResolvedMPSAStack {
  const config = loadMPSAConfig();
  const override = config.agent_stacks[agentId] ?? {};
  const modeId = override.reality_mode ?? config.default_reality_mode;
  const mode = getRealityMode(modeId) ?? getRealityMode(config.default_reality_mode)!;

  const layers: MPSALayer[] = [
    {
      id: "O",
      title: LAYER_TITLES.O,
      content: mode.o_layer,
      source: `reality:${mode.id}`,
    },
    {
      id: "P",
      title: LAYER_TITLES.P,
      content: mode.p_layer,
      source: `reality:${mode.id}`,
    },
    {
      id: "C",
      title: LAYER_TITLES.C,
      content: override.c_layer ?? config.shared.default_c_layer,
      source: override.c_layer ? `agent:${agentId}` : "shared",
    },
    {
      id: "G",
      title: LAYER_TITLES.G,
      content: override.g_layer ?? config.shared.default_g_layer,
      source: override.g_layer ? `agent:${agentId}` : "shared",
    },
    {
      id: "S",
      title: LAYER_TITLES.S,
      content: config.shared.shared_s_layer,
      source: "swarm-shared",
    },
  ];

  return {
    agent_id: agentId,
    reality_mode: mode.id,
    reality_name: mode.name,
    layers,
    execution_order: config.shared.execution_order,
  };
}

/** Compose system prompt: O → P → C → G → S (strict order). */
export function composeMPSASystemPrompt(opts: {
  agentId: string;
  agentName: string;
  mission: string;
  playbookExtra?: string;
  taskRules?: string;
}): { system: string; stack: ResolvedMPSAStack } {
  const stack = resolveAgentStack(opts.agentId);
  const mode = getRealityMode(stack.reality_mode);

  const layerBlocks = stack.layers.map((l) => `[${l.title}]\n${l.content}`);

  const system = [
    `You are ${opts.agentName} (agent: ${opts.agentId}) in AZZLE FORCE.`,
    `Mission: ${opts.mission}`,
    "",
    "=== MODULAR PROMPT STACK (MPSA) — execute reasoning in strict layer order ===",
    `Reality mode: ${stack.reality_name} (${stack.reality_mode})`,
    mode?.task_hint ? `Mode task: ${mode.task_hint}` : "",
    "",
    ...layerBlocks,
    "",
    "EXECUTION RULE: Reason O → P → C → G → S. No layer may override layers above S. S-Layer resolves conflicts.",
    opts.playbookExtra?.trim() ? `\n[Playbook variant]\n${opts.playbookExtra.trim()}` : "",
    opts.taskRules?.trim() ? `\n[Task rules]\n${opts.taskRules.trim()}` : "",
    "",
    "Output valid JSON matching the requested schema. No prose outside JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, stack };
}

export function listMPSAForObservatory(agentIds: string[]): {
  config: MPSAConfig;
  agents: ResolvedMPSAStack[];
  reality_modes: RealityMode[];
} {
  const config = loadMPSAConfig();
  const ids =
    agentIds.length > 0
      ? agentIds
      : [...new Set([...Object.keys(config.agent_stacks), "personalizer", "aaies", "closer"])];

  return {
    config,
    reality_modes: config.reality_modes,
    agents: ids.map((id) => resolveAgentStack(id)),
  };
}

export function mpsaConfigExists(): boolean {
  const root = mpsaConfigPath();
  return (
    existsSync(resolve(root, "shared-layers.json")) &&
    existsSync(resolve(root, "reality-modes.json")) &&
    existsSync(resolve(root, "agent-stacks.json"))
  );
}

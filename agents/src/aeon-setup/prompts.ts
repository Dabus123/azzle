import * as clack from "@clack/prompts";
import { AGENT_ROLES, ROLE_CATALOG, type AgentRole } from "./types.js";

export async function promptAgentRole(): Promise<AgentRole> {
  clack.intro("AZZLE Protocol setup — Base mainnet (chainId 8453)");

  const selected = await clack.select({
    message: "Choose an agent role to scaffold",
    options: ROLE_CATALOG.map((r) => ({
      value: r.id,
      label: r.label,
      hint: r.hint,
    })),
  });

  if (clack.isCancel(selected)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (!AGENT_ROLES.includes(selected as AgentRole)) {
    clack.log.error(`Invalid role: ${String(selected)}`);
    process.exit(1);
  }

  return selected as AgentRole;
}

export async function promptOutputDir(defaultDir: string): Promise<string> {
  const dir = await clack.text({
    message: "Output directory",
    placeholder: defaultDir,
    defaultValue: defaultDir,
  });

  if (clack.isCancel(dir)) {
    clack.cancel("Setup cancelled.");
    process.exit(0);
  }

  return (dir as string).trim() || defaultDir;
}

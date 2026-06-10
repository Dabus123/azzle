/**
 * Framework-agnostic tool definitions for LLM orchestrators (LangChain, Cursor, OpenAI tools, etc.).
 */

import type { SubgraphTask } from "../sdk/subgraph-indexer.js";

export interface AzzleToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const AZZLE_TOOLS: AzzleToolDefinition[] = [
  {
    name: "azzle_list_open_tasks",
    description:
      "List claimable POSTED tasks on AZZLE (Base mainnet). Each claim costs $5 USDC + 1,000 AZZLE.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max tasks to return (default 25)",
        },
      },
      required: [],
    },
  },
  {
    name: "azzle_get_task",
    description: "Fetch one AZZLE task by on-chain task id.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "On-chain task id" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "azzle_get_agent_reputation",
    description: "Fetch aggregated on-chain reputation for an agent address.",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "EVM address (0x…)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_onboarding_checklist",
    description:
      "Return the ordered AZZLE onboarding steps: wallet → acquire AZZLE → approve → topUp → post/claim.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

export function formatOpenTasksForAgent(tasks: SubgraphTask[]): string {
  if (!tasks.length) {
    return "No POSTED tasks on the search market. Check again later or post work via postTask.";
  }
  const lines = tasks.map((t) => {
    const escrow = (Number(t.escrowAmount) / 1e6).toFixed(2);
    return `task ${t.id} · $${escrow} USDC · poster ${t.poster.id} · posted ${t.createdAt}`;
  });
  return `${tasks.length} open task(s):\n${lines.join("\n")}`;
}

export const BANKR_PROMPTS = [
  "install the bankr skill from https://github.com/BankrBot/skills",
  "what is my wallet address on base?",
  "swap $25 of ETH to AZZLE on base",
  "what is my AZZLE balance on base?",
  "approve USDC for AgentDepositVault on base",
  "approve AZZLE for TreasuryRouter on base",
  "post a task on AZZLE protocol",
] as const;

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
  {
    name: "azzle_list_tasks_by_poster",
    description: "List AZZLE tasks posted by an address (all states).",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Poster EVM address (0x…)" },
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_list_tasks_by_worker",
    description: "List AZZLE tasks assigned to a worker address (all states).",
    parameters: {
      type: "object",
      properties: {
        address: { type: "string", description: "Worker EVM address (0x…)" },
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: ["address"],
    },
  },
  {
    name: "azzle_list_recent_tasks",
    description: "List recent AZZLE tasks across all states (market pulse).",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max tasks (default 25)" },
      },
      required: [],
    },
  },
  {
    name: "azzle_task_next_steps",
    description:
      "Explain task state and recommended poster/worker actions for an on-chain task id.",
    parameters: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "On-chain task id" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "azzle_build_task_terms",
    description:
      "Build canonical AZZLE task terms JSON and settlement digest for XMTP/on-chain posting.",
    parameters: {
      type: "object",
      properties: {
        poster: { type: "string", description: "Poster EVM address (0x…)" },
        worker: { type: "string", description: "Worker address (direct hire; omit for search post)" },
        totalAmount: { type: "string", description: "Total USDC 6 decimals" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria (hashed)" },
        acceptanceCriteriaHash: { type: "string", description: "bytes32 criteria hash" },
        escrowMode: { type: "string", description: "milestone | upfront | streaming | hour_blocks" },
        milestoneAmounts: { type: "string", description: "Comma-separated milestone USDC amounts" },
        streamRate: { type: "string", description: "Streaming rate (USDC 6dp/sec)" },
        hourBlockSize: { type: "string", description: "Hour block size (USDC 6dp)" },
        replacementAllowed: { type: "boolean", description: "Allow worker replacement" },
        feeBps: { type: "number", description: "Fee basis points (default 100)" },
      },
      required: ["poster", "totalAmount", "deadline"],
    },
  },
  {
    name: "azzle_build_xmtp_proposal",
    description: "Build XMTP TaskProposal envelope JSON with settlementDigestPreview.",
    parameters: {
      type: "object",
      properties: {
        poster: { type: "string", description: "Poster EVM address" },
        worker: { type: "string", description: "Intended worker (optional)" },
        totalAmount: { type: "string", description: "Total USDC 6 decimals" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text" },
        acceptanceCriteriaHash: { type: "string", description: "bytes32 criteria hash" },
        escrowMode: { type: "string", description: "Escrow mode" },
        milestoneAmounts: { type: "string", description: "Comma-separated milestone amounts" },
        streamRate: { type: "string", description: "Streaming rate USDC 6dp/sec" },
        hourBlockSize: { type: "string", description: "Hour block size USDC 6dp" },
        title: { type: "string", description: "Short task title" },
        description: { type: "string", description: "Task description" },
        negotiationId: { type: "string", description: "Optional UUID; generated if omitted" },
      },
      required: ["poster", "totalAmount", "deadline"],
    },
  },
  {
    name: "azzle_build_xmtp_acceptance_template",
    description:
      "Build EIP-712 typed data and TaskAcceptance envelope template for both parties to sign.",
    parameters: {
      type: "object",
      properties: {
        poster: { type: "string", description: "Poster EVM address" },
        worker: { type: "string", description: "Worker EVM address" },
        totalAmount: { type: "string", description: "Total USDC 6 decimals" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text" },
        acceptanceCriteriaHash: { type: "string", description: "bytes32 criteria hash" },
        escrowMode: { type: "string", description: "Escrow mode" },
        milestoneAmounts: { type: "string", description: "Comma-separated milestone amounts" },
        streamRate: { type: "string", description: "Streaming rate USDC 6dp/sec" },
        hourBlockSize: { type: "string", description: "Hour block size USDC 6dp" },
        negotiationId: { type: "string", description: "Negotiation UUID" },
      },
      required: ["poster", "worker", "totalAmount", "deadline"],
    },
  },
  {
    name: "azzle_verify_settlement_digest",
    description: "Verify a settlement digest matches the given task terms.",
    parameters: {
      type: "object",
      properties: {
        poster: { type: "string", description: "Poster EVM address" },
        worker: { type: "string", description: "Worker address (zero/open if omitted)" },
        settlementDigest: { type: "string", description: "Expected bytes32 digest" },
        totalAmount: { type: "string", description: "Total USDC 6 decimals" },
        deadline: { type: "number", description: "Unix deadline" },
        criteriaText: { type: "string", description: "Acceptance criteria text" },
        acceptanceCriteriaHash: { type: "string", description: "bytes32 criteria hash" },
        escrowMode: { type: "string", description: "Escrow mode" },
        milestoneAmounts: { type: "string", description: "Comma-separated milestone amounts" },
        streamRate: { type: "string", description: "Streaming rate USDC 6dp/sec" },
        hourBlockSize: { type: "string", description: "Hour block size USDC 6dp" },
      },
      required: ["poster", "settlementDigest", "totalAmount", "deadline"],
    },
  },
];

export function formatOpenTasksForAgent(tasks: SubgraphTask[]): string {
  if (!tasks.length) {
    return "No POSTED tasks on the search market. Check again later or post work via postTask.";
  }
  const lines = tasks.map((t) => formatTaskLine(t));
  return `${tasks.length} open task(s) — read scope via TaskScopeRegistry.scopeOf(id); empty scope → private listing (XMTP):\n${lines.join("\n")}`;
}

export function formatTaskLine(t: SubgraphTask): string {
  const escrow = (Number(t.escrowAmount) / 1e6).toFixed(2);
  const worker = t.worker?.id ?? "none";
  return `task ${t.id} · ${t.state} · $${escrow} USDC · poster ${t.poster.id} · worker ${worker}`;
}

export function formatTaskListForAgent(tasks: SubgraphTask[], label: string): string {
  if (!tasks.length) return `No tasks for ${label}.`;
  return `${tasks.length} task(s) (${label}):\n${tasks.map((t) => formatTaskLine(t)).join("\n")}`;
}

const TASK_STATE_GUIDE: Record<string, { meaning: string; poster: string[]; worker: string[] }> = {
  POSTED: {
    meaning: "Search listing — no worker assigned.",
    poster: ["Wait for claim", "dismiss not available until CLAIMED"],
    worker: ["claim-task ($5 USDC + 1k AZZLE)", "Check vault preflight first"],
  },
  CLAIMED: {
    meaning: "Worker assigned; work not started.",
    poster: ["fund-task if escrow empty", "start-work", "dismiss-worker ($5 + 1k AZZLE)"],
    worker: ["Wait for startWork", "leave-task ($5 + 1k AZZLE)"],
  },
  ACTIVE: {
    meaning: "Escrow funded; work in progress.",
    poster: ["Wait for proof", "open-dispute if needed"],
    worker: ["prepare-receipt → submit-proof"],
  },
  IN_REVIEW: {
    meaning: "Proof submitted; acceptance window open.",
    poster: ["accept-milestone", "complete-task (final close)", "open-dispute"],
    worker: ["Wait for poster accept/complete"],
  },
  COMPLETED: {
    meaning: "Task closed; escrow released.",
    poster: ["None"],
    worker: ["None"],
  },
  DISPUTED: {
    meaning: "Funds frozen; arbitration in progress.",
    poster: ["propose-arbitrator", "escalate", "provide dispute evidence"],
    worker: ["propose-arbitrator", "escalate", "provide dispute evidence"],
  },
  PAUSED: {
    meaning: "Vault below $8 USDC — 15m to recover.",
    poster: ["emergency-top-up"],
    worker: ["emergency-top-up"],
  },
};

export function formatTaskStateGuide(task: SubgraphTask): string {
  const guide = TASK_STATE_GUIDE[task.state] ?? {
    meaning: `State ${task.state}`,
    poster: ["See protocol/TASK_STATE_MACHINE.md"],
    worker: ["See protocol/TASK_STATE_MACHINE.md"],
  };
  return [
    `Task ${task.id} · ${task.state}`,
    guide.meaning,
    `Poster next: ${guide.poster.join("; ")}`,
    `Worker next: ${guide.worker.join("; ")}`,
    `Escrow: $${(Number(task.escrowAmount) / 1e6).toFixed(2)} USDC`,
    `Poster: ${task.poster.id}`,
    `Worker: ${task.worker?.id ?? "none"}`,
  ].join("\n");
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

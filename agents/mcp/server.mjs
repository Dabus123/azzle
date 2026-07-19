#!/usr/bin/env node
/**
 * AZZLE MCP server — Base RPC discovery tools for Cursor / Claude Desktop.
 *
 * Prerequisite: cd agents && npm run build
 * Config: see launch-skills/DISTRIBUTION.md
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { BaseRpcIndexer } from "../dist/sdk/base-rpc-indexer.js";
import {
  AZZLE_TOOLS,
  BANKR_PROMPTS,
  formatOpenTasksForAgent,
  formatTaskListForAgent,
  formatTaskStateGuide,
} from "../dist/tools/azzle-tools.js";
import { termFlagsFromMcpArgs } from "./mcp-term-flags.mjs";
import {
  buildTaskTermsBundle,
  buildXmtpProposal,
  buildXmtpAcceptanceTemplate,
  verifySettlementDigest,
} from "./xmtp-helpers.mjs";

const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../deployments/base-8453.json"), "utf8")
);

const indexer = new BaseRpcIndexer();

const server = new Server(
  { name: "azzle", version: "0.4.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: AZZLE_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "azzle_list_open_tasks": {
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getOpenTasks();
        const slice = tasks.slice(0, limit);
        return {
          content: [{ type: "text", text: formatOpenTasksForAgent(slice) }],
        };
      }
      case "azzle_get_task": {
        const taskId = String(args?.taskId ?? "");
        const task = await indexer.getTask(taskId);
        return {
          content: [
            {
              type: "text",
              text: task ? JSON.stringify(task, null, 2) : `Task ${taskId} not found`,
            },
          ],
        };
      }
      case "azzle_get_agent_reputation": {
        return {
          content: [
            {
              type: "text",
              text: "Use the paid azzle-reputation x402 Cloud endpoint for reputation history.",
            },
          ],
        };
      }
      case "azzle_onboarding_checklist": {
        return {
          content: [
            {
              type: "text",
              text: [
                "AZZLE onboarding (Base 8453):",
                "1. Fund wallet with ETH + USDC on Base",
                "2. Swap to ≥ 10,000 AZZLE",
                "3. approve USDC → AgentDepositVault",
                "4. approve AZZLE → TreasuryRouter",
                "5. AgentDepositVault.topUp(≥ $25 USDC)",
                "6. postTask or claimTask ($5 USDC + 1,000 AZZLE each)",
                "",
                "Prepare helpers (agents/): npm run mcp:prepare -- hash-criteria --text \"...\"",
                "  npm run mcp:prepare -- prepare-receipt --task-id ... --worker ... --artifact-hash ...",
                "",
                "Bankr prompts:",
                ...BANKR_PROMPTS.map((p) => `  ${p}`),
                "",
                "Docs: https://github.com/Dabus123/azzle/blob/main/launch-skills/launch-skills.md",
              ].join("\n"),
            },
          ],
        };
      }
      case "azzle_list_tasks_by_poster": {
        const address = String(args?.address ?? "");
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getTasksByPoster(address, limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, `poster ${address}`),
            },
          ],
        };
      }
      case "azzle_list_tasks_by_worker": {
        const address = String(args?.address ?? "");
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getTasksByWorker(address, limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, `worker ${address}`),
            },
          ],
        };
      }
      case "azzle_list_recent_tasks": {
        const limit = Number(args?.limit ?? 25);
        const tasks = await indexer.getRecentTasks(limit);
        return {
          content: [
            {
              type: "text",
              text: formatTaskListForAgent(tasks, "recent"),
            },
          ],
        };
      }
      case "azzle_task_next_steps": {
        const taskId = String(args?.taskId ?? "");
        const task = await indexer.getTask(taskId);
        return {
          content: [
            {
              type: "text",
              text: task
                ? formatTaskStateGuide(task)
                : `Task ${taskId} not found`,
            },
          ],
        };
      }
      case "azzle_build_task_terms": {
        const flags = termFlagsFromMcpArgs(args);
        const result = buildTaskTermsBundle(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest,
          { requireWorker: Boolean(flags.worker) }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "azzle_build_xmtp_proposal": {
        const flags = termFlagsFromMcpArgs(args);
        const result = buildXmtpProposal(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest,
          { requireWorker: Boolean(flags.worker) }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "azzle_build_xmtp_acceptance_template": {
        const flags = termFlagsFromMcpArgs(args);
        const result = buildXmtpAcceptanceTemplate(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest,
          { requireWorker: true }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "azzle_verify_settlement_digest": {
        const flags = termFlagsFromMcpArgs(args);
        flags.digest = String(args?.settlementDigest ?? flags.digest ?? "");
        const result = verifySettlementDigest(
          flags.from ?? String(args?.poster ?? ""),
          flags,
          manifest,
          { requireWorker: Boolean(flags.worker) }
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: err.message ?? String(err) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

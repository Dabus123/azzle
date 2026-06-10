#!/usr/bin/env node
/**
 * AZZLE MCP server — subgraph discovery tools for Cursor / Claude Desktop.
 *
 * Prerequisite: cd agents && npm run build
 * Config: see launch-skills/DISTRIBUTION.md
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { SubgraphIndexer } from "../dist/sdk/subgraph-indexer.js";
import {
  AZZLE_TOOLS,
  BANKR_PROMPTS,
  formatOpenTasksForAgent,
} from "../dist/tools/azzle-tools.js";

const indexer = new SubgraphIndexer();

const server = new Server(
  { name: "azzle", version: "0.2.0" },
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
        const address = String(args?.address ?? "");
        const agent = await indexer.getAgentReputation(address);
        return {
          content: [
            {
              type: "text",
              text: agent ? JSON.stringify(agent, null, 2) : `No agent ${address}`,
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
                "5. AgentDepositVault.topUp(≥ $20 USDC)",
                "6. postTask or claimTask ($5 USDC + 1,000 AZZLE each)",
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

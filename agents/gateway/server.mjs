/**
 * AZZLE HTTP gateway — Base RPC market reads + payment receipts.
 *
 * Usage:
 *   cd agents && npm run build && npm run gateway
 *   curl http://localhost:4020/v1/market/open
 *   curl -X POST http://localhost:4020/v1/payment-receipt -H "Content-Type: application/json" -d '{"payer":"0x...","action":"claim","taskId":"1"}'
 *
 * @see docs/X402_PAYMENTS.md
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";
import { BASE_MAINNET_MANIFEST } from "../dist/sdk/manifest.js";
import {
  ACCESS_FEE_AZL_18,
  build402Response,
  buildPaymentReceipt,
  isReceiptValid,
} from "../dist/sdk/x402-payments.js";
import { checkWorkerPreflight } from "../dist/sdk/preflight.js";
import { RpcDiscovery } from "../dist/sdk/rpc-discovery.js";

const PORT = Number(process.env.AZZLE_GATEWAY_PORT ?? "4020");
const RPC = process.env.BASE_RPC_URL ?? "https://mainnet.base.org";
const manifest = BASE_MAINNET_MANIFEST;
const provider = new ethers.JsonRpcProvider(RPC);
const indexer = new RpcDiscovery({ rpcUrl: RPC });
const receipts = new Map();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SURFACES_ROOT = normalize(join(__dirname, "..", "..", "launch-skills"));

const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

async function serveStatic(pathname, res) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(SURFACES_ROOT, rel.replace(/^\//, "")));
  if (!filePath.startsWith(SURFACES_ROOT) || !existsSync(filePath)) {
    return false;
  }
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
  const body = await readFile(filePath);
  res.writeHead(200, {
    "Content-Type": STATIC_MIME[ext] ?? "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
  return true;
}

function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Azzle-Payment-Receipt",
    ...extraHeaders,
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function routeAction(path) {
  if (path === "/v1/tasks" || path === "/v1/tasks/post") return "post";
  const claim = path.match(/^\/v1\/tasks\/(\d+)\/claim$/);
  if (claim) return { action: "claim", taskId: claim[1] };
  const dismiss = path.match(/^\/v1\/tasks\/(\d+)\/dismiss$/);
  if (dismiss) return { action: "dismiss", taskId: dismiss[1] };
  const leave = path.match(/^\/v1\/tasks\/(\d+)\/leave$/);
  if (leave) return { action: "leave", taskId: leave[1] };
  return null;
}

async function readinessFromPreflight(payer) {
  const report = await checkWorkerPreflight(provider, payer, {
    agentDepositVault: manifest.depositVault,
    treasuryRouter: manifest.treasuryRouter,
    azlToken: manifest.external.azl,
    usdc: manifest.external.usdc,
  });
  const missing = [];
  if (report.vaultUsdc < 25_000_000n) missing.push("vault balance < $25 for post/claim");
  if (report.azlBalance < ACCESS_FEE_AZL_18) missing.push("AZZLE balance < 1,000");
  if (!report.azlAllowanceOk) missing.push("AZZLE allowance for TreasuryRouter < 1,000");
  return {
    payer,
    ready: missing.length === 0,
    usdcVaultBalance: report.vaultUsdc,
    azlBalance: report.azlBalance,
    azlAllowance: report.azlAllowance,
    missing,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Azzle-Payment-Receipt",
    });
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && path === "/health") {
      json(res, 200, { ok: true, chainId: 8453, source: "base-rpc" });
      return;
    }

    if (req.method === "GET" && path === "/v1/fees") {
      json(res, 200, {
        accessFee: { usdc: "5000000", azl: ACCESS_FEE_AZL_18.toString() },
        manifest,
        actions: ["post", "claim", "dismiss", "leave"],
      });
      return;
    }

    if (req.method === "GET" && path === "/v1/market/open") {
      const tasks = await indexer.getOpenTasks();
      json(res, 200, { count: tasks.length, tasks });
      return;
    }

    if (req.method === "GET" && path === "/v1/market/recent") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const tasks = await indexer.getRecentTasks(limit);
      json(res, 200, { count: tasks.length, tasks });
      return;
    }

    if (req.method === "GET" && path === "/v1/leaderboard/reputation") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const agents = await indexer.getTopAgents(limit);
      json(res, 200, { count: agents.length, agents });
      return;
    }

    if (req.method === "GET" && path === "/v1/leaderboard/verifiers") {
      const limit = Number(url.searchParams.get("limit") ?? "25");
      const agents = await indexer.getVerifierLeaderboard(limit);
      json(res, 200, { count: agents.length, agents });
      return;
    }

    const taskMatch = path.match(/^\/v1\/tasks\/(\d+)$/);
    if (req.method === "GET" && taskMatch) {
      const task = await indexer.getTask(taskMatch[1]);
      if (!task) {
        json(res, 404, { error: "task not found" });
        return;
      }
      json(res, 200, { task });
      return;
    }

    if (req.method === "POST" && path === "/v1/payment-receipt") {
      const body = await readBody(req);
      const payer = body.payer;
      const action = body.action;
      const taskId = body.taskId;
      if (!payer || !action) {
        json(res, 400, { error: "payer and action required" });
        return;
      }
      const readiness = await readinessFromPreflight(payer);
      const receipt = buildPaymentReceipt(payer, action, readiness, taskId);
      receipts.set(receipt.id, receipt);
      json(res, readiness.ready ? 200 : 402, { receipt, readiness, manifest });
      return;
    }

    const routed = routeAction(path);
    if (req.method === "POST" && routed) {
      const action = typeof routed === "string" ? routed : routed.action;
      const taskId = typeof routed === "object" ? routed.taskId : undefined;
      const receiptHeader = req.headers["x-azzle-payment-receipt"];
      const body = await readBody(req);
      const payer = body.payer;

      if (!receiptHeader || !payer) {
        const r402 = build402Response(manifest, action, taskId);
        json(res, r402.status, {
          error: "payment_required",
          message: "Pay $5 USDC + 1,000 AZZLE on-chain, or POST /v1/payment-receipt first",
          payment: r402.body,
          next: {
            issueReceipt: "POST /v1/payment-receipt",
            header: "X-Azzle-Payment-Receipt",
          },
        }, r402.headers);
        return;
      }

      const receipt = receipts.get(String(receiptHeader));
      if (!receipt || !isReceiptValid(receipt, payer, action, taskId)) {
        json(res, 402, { error: "invalid_or_expired_receipt" });
        return;
      }

      json(res, 200, {
        ok: true,
        message: "Receipt valid — submit the matching on-chain tx from the payer wallet",
        action,
        taskId,
        registry: manifest.taskRegistry,
        method:
          action === "post"
            ? "postTask"
            : action === "claim"
              ? "claimTask"
              : action === "dismiss"
                ? "dismissWorker"
                : "leaveTask",
        receipt,
      });
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(path, res))) {
      return;
    }

    json(res, 404, {
      error: "not_found",
      routes: [
        "GET /",
        "GET /market.html",
        "GET /leaderboard.html",
        "GET /treasury-dashboard.html",
        "GET /health",
        "GET /v1/fees",
        "GET /v1/market/open",
        "GET /v1/market/recent",
        "POST /v1/graphql",
        "GET /v1/leaderboard/reputation",
        "GET /v1/leaderboard/verifiers",
        "GET /v1/tasks/:id",
        "POST /v1/payment-receipt",
        "POST /v1/tasks",
        "POST /v1/tasks/:id/claim",
        "POST /v1/tasks/:id/dismiss",
        "POST /v1/tasks/:id/leave",
      ],
    });
  } catch (err) {
    json(res, 500, { error: err.message ?? String(err) });
  }
});

server.listen(PORT, () => {
  console.log(`[azzle-gateway] http://localhost:${PORT}`);
  console.log("[azzle-gateway] hub     GET /  (launch-skills UI)");
  console.log("[azzle-gateway] market  GET /market.html  ·  GET /v1/market/open");
  console.log("[azzle-gateway] x402    POST /v1/tasks/:id/claim (no receipt → 402)");
});

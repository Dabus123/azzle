/**
 * Minimal x402 stub — 402 responses only (no market reads, no receipt store).
 * @see docs/X402_PAYMENTS.md · agents/x402/README.md
 */
import { createServer } from "node:http";
import { BASE_MAINNET_MANIFEST } from "../dist/sdk/manifest.js";
import { build402Response } from "../dist/sdk/x402-payments.js";

const PORT = Number(process.env.AZZLE_X402_STUB_PORT ?? "4021");
const manifest = BASE_MAINNET_MANIFEST;

function json(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true, stub: true, chainId: 8453 });
    return;
  }

  const claim = url.pathname.match(/^\/v1\/tasks\/(\d+)\/claim$/);
  const action = url.pathname === "/v1/tasks" ? "post" : claim ? "claim" : null;

  if (req.method === "POST" && action) {
    const taskId = claim?.[1];
    const r402 = build402Response(manifest, action, taskId);
    json(
      res,
      r402.status,
      {
        error: "payment_required",
        stub: true,
        payment: r402.body,
        hint: "Pay on-chain then submit TaskRegistry tx from payer wallet",
      },
      r402.headers
    );
    return;
  }

  json(res, 404, {
    error: "not_found",
    routes: ["GET /health", "POST /v1/tasks", "POST /v1/tasks/:id/claim"],
  });
});

server.listen(PORT, () => {
  console.log(`[x402-stub] http://localhost:${PORT}`);
});

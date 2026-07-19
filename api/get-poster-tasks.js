const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

import { getPosterTasks } from "./lib/poster-tasks.js";

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const host = req.headers?.host || "azzle.org";
    const url = new URL(req.url || "/api/get-poster-tasks", "https://" + host);
    const id = normAddr(url.searchParams.get("address"));
    if (!id) {
      sendJson(res, 400, { error: "Wallet address required" });
      return;
    }

    const tasks = await getPosterTasks(id);
    sendJson(res, 200, { tasks });
  } catch (err) {
    sendJson(res, 502, { error: "Base RPC unavailable", detail: err?.message ?? String(err) });
  }
}

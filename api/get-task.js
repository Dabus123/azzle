import { getTaskDetail } from "./lib/task-detail.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
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
    const url = new URL(req.url || "/api/get-task", "https://" + host);
    const id = url.searchParams.get("id") ?? url.searchParams.get("taskId");
    if (!id) {
      sendJson(res, 400, { error: "Task id required" });
      return;
    }

    const task = await getTaskDetail(id);
    if (!task) {
      sendJson(res, 404, { error: "Task not found" });
      return;
    }

    sendJson(res, 200, { task });
  } catch (err) {
    sendJson(res, 502, { error: "Base RPC unavailable", detail: err?.message ?? String(err) });
  }
}

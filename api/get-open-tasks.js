import { getOpenTasks } from "./lib/open-tasks.js";

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
    const url = new URL(req.url || "/api/get-open-tasks", "https://" + host);
    const limit = url.searchParams.get("limit");
    const tasks = await getOpenTasks(limit);

    sendJson(res, 200, { tasks, count: tasks.length });
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

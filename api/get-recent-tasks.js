import { getRecentTasks } from "./lib/recent-tasks.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=300";

function sendJson(res, status, body, extra = {}) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json", ...extra });
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
    const url = new URL(req.url || "/api/get-recent-tasks", "https://" + host);
    const limit = url.searchParams.get("limit");
    const tasks = await getRecentTasks(limit);

    sendJson(res, 200, { tasks, count: tasks.length }, { "Cache-Control": CACHE_CONTROL });
  } catch (err) {
    sendJson(res, 502, { error: err?.message ?? String(err) });
  }
}

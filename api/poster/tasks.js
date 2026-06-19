import { getPosterTasks } from "../lib/poster-tasks.js";
import { readJsonBody, requestUrl } from "../lib/vercel-http.js";
import { sendJson } from "../lib/respond.js";

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*" });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    const url = requestUrl(req, "/api/poster/tasks");
    const address = url.searchParams.get("address");
    const tasks = await getPosterTasks(address);
    sendJson(res, 200, { tasks });
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

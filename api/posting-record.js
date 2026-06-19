import { readJsonBody } from "./lib/vercel-http.js";
import { CORS, sendJson } from "./lib/respond.js";

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const { recordPost } = await import("./lib/posting-limits.js");
    const quota = await recordPost(body.address, { taskId: body.taskId, txHash: body.txHash });
    sendJson(res, 200, quota);
  } catch (err) {
    const status = err.code === "QUOTA_EXCEEDED" ? 429 : 400;
    sendJson(res, status, { error: err.message, quota: err.quota ?? null });
  }
}

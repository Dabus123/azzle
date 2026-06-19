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
    const { assertCanPost } = await import("./lib/posting-limits.js");
    const quota = await assertCanPost(body.address);
    sendJson(res, 200, quota);
  } catch (err) {
    sendJson(res, 429, { error: err.message, quota: err.quota ?? null });
  }
}

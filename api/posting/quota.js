import { requestUrl } from "../lib/vercel-http.js";
import { CORS, sendJson } from "../lib/respond.js";

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

    const url = requestUrl(req, "/api/posting/quota");
    const address = url.searchParams.get("address");
    const { getQuota } = await import("../lib/posting-limits.js");
    const quota = await getQuota(address);
    sendJson(res, 200, quota);
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

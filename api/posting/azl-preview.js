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

    const url = requestUrl(req, "/api/posting/azl-preview");
    const tier = url.searchParams.get("tier");
    const { previewAzlUpgrade } = await import("../lib/posting-limits.js");
    const preview = await previewAzlUpgrade(tier);
    sendJson(res, 200, preview);
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

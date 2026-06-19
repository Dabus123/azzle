import { handleSiteApi } from "../../scripts/site-api.mjs";
import { readJsonBody, requestUrl } from "../../scripts/vercel-http.mjs";
import { sendJson } from "../lib/respond.js";

export default async function handler(req, res) {
  try {
    const url = requestUrl(req, "/api/poster/tasks");
    let body = {};
    if (req.method === "POST") {
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { error: "Invalid JSON body" });
        return;
      }
    }
    const result = await handleSiteApi({
      method: req.method ?? "GET",
      pathname: "/api/poster/tasks",
      searchParams: url.searchParams,
      body,
    });
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

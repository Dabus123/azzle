import { handleSiteApi } from "../../scripts/site-api.mjs";
import { readJsonBody, requestUrl } from "../../scripts/vercel-http.mjs";
import { CORS, sendJson } from "../lib/respond.js";

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
    const url = requestUrl(req, "/api/role-chat");
    const result = await handleSiteApi({
      method: "POST",
      pathname: "/api/role-chat",
      searchParams: url.searchParams,
      body,
    });
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

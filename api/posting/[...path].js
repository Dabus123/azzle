import { handleSiteApi } from "../../scripts/site-api.mjs";
import { readJsonBody, requestUrl } from "../../scripts/vercel-http.mjs";
import { sendJson } from "../lib/respond.js";

function postingPath(req) {
  const parts = req.query.path;
  const sub = parts ? (Array.isArray(parts) ? parts.join("/") : parts) : "";
  return "/api/posting/" + String(sub).replace(/^\/+/, "");
}

export default async function handler(req, res) {
  try {
    const pathname = postingPath(req);
    const url = requestUrl(req, pathname);
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
      pathname,
      searchParams: url.searchParams,
      body,
    });
    if (result.status === 204) {
      res.writeHead(204, result.headers ?? {});
      res.end();
      return;
    }
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

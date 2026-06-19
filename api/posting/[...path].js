import { handleSiteApi } from "../../scripts/site-api.mjs";
import { CORS, readJsonBody, requestUrl, sendApiResult } from "../../scripts/vercel-http.mjs";

export const config = { maxDuration: 60 };

function postingPath(req) {
  const parts = req.query.path;
  const sub = parts ? (Array.isArray(parts) ? parts.join("/") : parts) : "";
  return "/api/posting/" + sub.replace(/^\/+/, "");
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
        sendApiResult(res, {
          status: 400,
          headers: { "Content-Type": "application/json" },
          json: { error: "Invalid JSON body" },
        });
        return;
      }
    }
    const result = await handleSiteApi({
      method: req.method ?? "GET",
      pathname,
      searchParams: url.searchParams,
      body,
    });
    sendApiResult(res, result);
  } catch (err) {
    sendApiResult(res, {
      status: 500,
      headers: { "Content-Type": "application/json" },
      json: { error: err?.message ?? String(err) },
    });
  }
}

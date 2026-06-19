import { handlePostingApi } from "../lib/posting-router.js";
import { readJsonBody, requestUrl } from "../lib/vercel-http.js";
import { CORS, sendJson } from "../lib/respond.js";

function postingPath(req) {
  const parts = req.query.path;
  const sub = parts ? (Array.isArray(parts) ? parts.join("/") : parts) : "";
  return "/api/posting/" + String(sub).replace(/^\/+/, "");
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

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

    const result = await handlePostingApi({
      method: req.method ?? "GET",
      pathname,
      searchParams: url.searchParams,
      body,
    });

    if (result.status === 204) {
      res.writeHead(204, result.headers ?? CORS);
      res.end();
      return;
    }
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

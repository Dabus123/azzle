import { handleSiteApi } from "../../scripts/site-api.mjs";
import { readJsonBody, requestUrl, sendApiResult } from "../../scripts/vercel-http.mjs";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  try {
    const url = requestUrl(req, "/api/poster/tasks");
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
      pathname: "/api/poster/tasks",
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

import { handleSiteApi } from "../../scripts/site-api.mjs";
import { CORS, readJsonBody, requestUrl, sendApiResult } from "../../scripts/vercel-http.mjs";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      sendApiResult(res, { status: 204, headers: CORS, json: null });
      return;
    }
    if (req.method !== "POST") {
      sendApiResult(res, {
        status: 405,
        headers: { "Content-Type": "application/json" },
        json: { error: "method_not_allowed" },
      });
      return;
    }
    let body = {};
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
    const url = requestUrl(req, "/api/role-chat");
    const result = await handleSiteApi({
      method: "POST",
      pathname: "/api/role-chat",
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

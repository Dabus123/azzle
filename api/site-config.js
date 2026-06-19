import { buildSiteConfigResponse } from "../scripts/site-config-handler.mjs";
import { CORS, sendApiResult } from "../scripts/vercel-http.mjs";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      sendApiResult(res, { status: 204, headers: CORS, json: null });
      return;
    }
    if (req.method !== "GET") {
      sendApiResult(res, {
        status: 405,
        headers: { "Content-Type": "application/json" },
        json: { error: "method_not_allowed" },
      });
      return;
    }
    sendApiResult(res, buildSiteConfigResponse());
  } catch (err) {
    sendApiResult(res, {
      status: 500,
      headers: { "Content-Type": "application/json" },
      json: { error: err?.message ?? String(err) },
    });
  }
}

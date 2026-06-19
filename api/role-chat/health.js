import { baseCfg } from "../scripts/manifest.mjs";
import { CORS, apiJson, sendApiResult } from "../scripts/vercel-http.mjs";

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      sendApiResult(res, { status: 204, headers: CORS, json: null });
      return;
    }
    const { BANKR_KEY, BANKR_BASE, MODEL } = baseCfg();
    sendApiResult(res, apiJson(200, { ok: Boolean(BANKR_KEY), model: MODEL, gateway: BANKR_BASE }));
  } catch (err) {
    sendApiResult(res, {
      status: 500,
      headers: { "Content-Type": "application/json" },
      json: { error: err?.message ?? String(err) },
    });
  }
}

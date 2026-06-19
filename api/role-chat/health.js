import { CORS, sendJson } from "../lib/respond.js";

export default function handler(req, res) {
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

    const key = process.env.BANKR_API_KEY || process.env.BANKR_KEY || "";
    const gateway = (process.env.OPENAI_BASE_URL || "https://llm.bankr.bot/v1").replace(/\/$/, "");

    sendJson(res, 200, {
      ok: Boolean(key),
      model: process.env.AZZLE_LLM_MODEL || "deepseek-v4-flash",
      gateway,
    });
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}

import { requestUrl } from "./lib/vercel-http.js";
import { CORS, sendJson } from "./lib/respond.js";

export default async function handler(req, res) {
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
    const url = requestUrl(req, "/api/posting/quote");
    const { createUpgradeQuote } = await import("./lib/posting-limits.js");
    const payWith = url.searchParams.get("payWith") ?? "azl";
    if (payWith !== "azl") throw new Error("Only payWith=azl is supported for quotes.");
    const quote = await createUpgradeQuote({
      address: url.searchParams.get("address"),
      tier: url.searchParams.get("tier"),
    });
    sendJson(res, 200, quote);
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

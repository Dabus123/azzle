import { readJsonBody } from "./lib/vercel-http.js";
import { CORS, sendJson } from "./lib/respond.js";
import { loadManifest } from "./lib/manifest.js";

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
    const MANIFEST = loadManifest();
    const billingWallet =
      process.env.AZZLE_BILLING_WALLET || MANIFEST?.feeRecipient || "";
    if (!billingWallet) throw new Error("Billing wallet not configured on server.");
    if (!MANIFEST?.external?.usdc) throw new Error("USDC address missing from V2 manifest.");
    const { applyUpgrade } = await import("./lib/posting-limits.js");
    const quota = await applyUpgrade({
      address: body.address,
      tier: body.tier,
      txHash: body.txHash,
      billingWallet,
      usdcAddress: MANIFEST.external.usdc,
      azlAddress: MANIFEST.external.azl,
      rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      payWith: body.payWith ?? "usdc",
      quoteId: body.quoteId,
    });
    sendJson(res, 200, quota);
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

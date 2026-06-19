import { PLANS, AZL_PAY_DISCOUNT } from "../lib/plans.js";
import { loadManifest } from "../lib/manifest.js";
import { CORS, sendJson } from "../lib/respond.js";

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  const manifest = loadManifest();
  const billingWallet =
    process.env.AZZLE_BILLING_WALLET || manifest?.feeRecipient || "";

  sendJson(res, 200, {
    plans: Object.values(PLANS),
    billingWallet: billingWallet || null,
    azlPayDiscount: AZL_PAY_DISCOUNT,
  });
}

import {
  fetchAzlUsdPrice,
  azlTokensForUsd,
  azlWeiForUsd,
  azlCheckoutAllowed,
  formatAzlHuman,
} from "./lib/azl-price-lite.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLANS = {
  basic: { priceUsdc: 20 },
  premium: { priceUsdc: 60 },
  enterprise: { priceUsdc: 5000 },
};

const AZL_PAY_DISCOUNT = 0.1;

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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

    const host = req.headers?.host || "azzle.org";
    const url = new URL(req.url || "/api/posting/azl-preview", "https://" + host);
    const tier = url.searchParams.get("tier");
    const plan = PLANS[tier];
    if (!plan?.priceUsdc) throw new Error("Invalid upgrade tier");

    const { priceUsd, source, updatedAt } = await fetchAzlUsdPrice();
    const discountedUsd = plan.priceUsdc * (1 - AZL_PAY_DISCOUNT);
    const azlAmount = azlTokensForUsd(discountedUsd, priceUsd);
    const checkout = azlCheckoutAllowed(azlAmount);

    sendJson(res, 200, {
      tier,
      listPriceUsdc: plan.priceUsdc,
      discountedUsd,
      discountPercent: AZL_PAY_DISCOUNT * 100,
      azlUsdPrice: priceUsd,
      azlPriceSource: source,
      azlPriceUpdatedAt: updatedAt,
      azlAmount,
      azlAmountFormatted: formatAzlHuman(azlAmount),
      azlAllowed: checkout.ok,
      azlBlockedReason: checkout.ok ? null : checkout.reason,
      minAzlWei: azlWeiForUsd(discountedUsd, priceUsd),
    });
  } catch (err) {
    sendJson(res, 400, { error: err?.message ?? String(err) });
  }
}

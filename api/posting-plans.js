const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PLANS = [
  { id: "free", label: "Free", dailyLimit: 3, priceUsdc: 0, billing: "none", description: "3 tasks per day" },
  { id: "basic", label: "Basic", dailyLimit: 50, priceUsdc: 20, billing: "monthly", description: "50 tasks per day · $20 USDC/month" },
  { id: "premium", label: "Premium", dailyLimit: 300, priceUsdc: 60, billing: "monthly", description: "300 tasks per day · $60 USDC/month" },
  { id: "enterprise", label: "Enterprise", dailyLimit: null, priceUsdc: 5000, billing: "lifetime", description: "Unlimited · one-time $5,000 USDC" },
];

const FEE_RECIPIENT = "0x41f35485Dea9e5e7C683d1C6CA650e8179c606ba";

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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

  const billingWallet = process.env.AZZLE_BILLING_WALLET || FEE_RECIPIENT || "";

  sendJson(res, 200, {
    plans: PLANS,
    billingWallet: billingWallet || null,
    azlPayDiscount: 0.1,
  });
}

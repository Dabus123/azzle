/** Posting tier definitions (no viem / storage deps). */
export const AZL_PAY_DISCOUNT = 0.1;
export const QUOTE_TTL_MS = 15 * 60 * 1000;

export const PLANS = {
  free: {
    id: "free",
    label: "Free",
    dailyLimit: 3,
    priceUsdc: 0,
    billing: "none",
    description: "3 tasks per day",
  },
  basic: {
    id: "basic",
    label: "Basic",
    dailyLimit: 50,
    priceUsdc: 20,
    billing: "monthly",
    description: "50 tasks per day · $20 USDC/month",
  },
  premium: {
    id: "premium",
    label: "Premium",
    dailyLimit: 300,
    priceUsdc: 60,
    billing: "monthly",
    description: "300 tasks per day · $60 USDC/month",
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise",
    dailyLimit: null,
    priceUsdc: 5000,
    billing: "lifetime",
    description: "Unlimited · one-time $5,000 USDC",
  },
};

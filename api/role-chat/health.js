/** Standalone health check — no imports (avoids Vercel cold-start crashes). */
export const config = { maxDuration: 10 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).set(CORS).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).set({ ...CORS, "Content-Type": "application/json" }).json({ error: "method_not_allowed" });
    return;
  }

  const key = process.env.BANKR_API_KEY || process.env.BANKR_KEY || "";
  const gateway = (process.env.OPENAI_BASE_URL || "https://llm.bankr.bot/v1").replace(/\/$/, "");

  res.status(200).set({ ...CORS, "Content-Type": "application/json" }).json({
    ok: Boolean(key),
    model: process.env.AZZLE_LLM_MODEL || "deepseek-v4-flash",
    gateway,
  });
}

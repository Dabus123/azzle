import { getUnionOverview } from "./lib/union-staking.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.writeHead(204, { "Access-Control-Allow-Origin": "*" }).end();
  if (req.method !== "GET") return res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "method_not_allowed" }));
  try {
    const overview = await getUnionOverview();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300" });
    res.end(JSON.stringify(overview));
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: error?.message ?? String(error) }));
  }
}

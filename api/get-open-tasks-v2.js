import { listV2Tasks } from "./lib/tasks-rpc-v2.js";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== "GET") { res.writeHead(405, { ...CORS, "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "method_not_allowed" })); return; }
  try {
    const url = new URL(req.url || "/api/v2/get-open-tasks", `https://${req.headers?.host || "azzle.org"}`);
    const requestedState = url.searchParams.get("state");
    const result = await listV2Tasks({
      limit: url.searchParams.get("limit") ?? 100,
      state: requestedState === "ALL" ? undefined : requestedState || "POSTED",
      cursor: url.searchParams.get("cursor") ?? undefined,
      minAmountAzlWei: url.searchParams.get("minAmountAzlWei") ?? undefined,
      poster: url.searchParams.get("poster") ?? undefined,
      worker: url.searchParams.get("worker") ?? undefined,
      taskType: url.searchParams.get("taskType") ?? undefined,
      capability: url.searchParams.getAll("capability"),
      verificationMode: url.searchParams.get("verificationMode") ?? undefined,
      beforeDeadline: url.searchParams.get("beforeDeadline") ?? undefined,
      metadataUri: url.searchParams.get("metadataUri") ?? undefined,
    });
    res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" });
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(503, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "v2_unavailable", message: error?.message ?? String(error) }));
  }
}
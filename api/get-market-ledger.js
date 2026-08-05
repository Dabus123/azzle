import { listV2Tasks } from "./lib/tasks-rpc-v2.js";
import { summarizeLedger } from "./lib/market-ledger.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== "GET") {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const url = new URL(req.url || "/api/get-market-ledger", `https://${req.headers?.host || "azzle.org"}`);
  const address = url.searchParams.get("address");
  if (!address) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "address_required" }));
    return;
  }
  try {
    const [posterTasks, workerTasks] = await Promise.all([
      listV2Tasks({ limit: 100, poster: address, state: undefined }),
      listV2Tasks({ limit: 100, worker: address, state: undefined }),
    ]);
    const seen = new Set();
    const tasks = [...posterTasks.tasks, ...workerTasks.tasks].filter((task) => {
      if (seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    });
    const ledger = summarizeLedger(tasks, address);
    res.writeHead(200, { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, s-maxage=30" });
    res.end(JSON.stringify(ledger));
  } catch (error) {
    res.writeHead(503, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "v2_unavailable", message: error?.message ?? String(error) }));
  }
}

import { deliveryState, validateDeliveryReceipt } from "./lib/delivery-state.js";
import { getTaskDetail } from "./lib/task-detail.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function body(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => { text += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(text || "{}")); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return; }
  if (req.method !== "POST") {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  try {
    const input = await body(req);
    const taskId = String(input.taskId ?? "").replace(/^v2:/, "");
    const task = await getTaskDetail(taskId);
    if (!task) {
      res.writeHead(404, { ...CORS, "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "task_not_found" }));
      return;
    }
    const validation = validateDeliveryReceipt(input.receipt, taskId, task.worker);
    const status = deliveryState(task, input.receipt);
    res.writeHead(validation.valid ? 200 : 422, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({
      protocolVersion: "v2",
      taskId: `v2:${taskId}`,
      accepted: validation.valid,
      validation,
      delivery: status,
      nextAction: validation.valid ? "worker_must_call_markDelivered_then_poster_releases" : "correct_receipt",
    }));
  } catch (error) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_receipt", message: error?.message ?? String(error) }));
  }
}

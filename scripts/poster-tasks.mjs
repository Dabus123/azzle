/** Poster task list via the canonical V2 Base RPC reader. */
import { listRecentTaskRows } from "../api/lib/base-tasks.js";

export async function getPosterTasks(address) {
  const id = String(address ?? "").trim().toLowerCase();
  if (!id) throw new Error("Wallet address required");
  return listRecentTaskRows(100, (task) => task.poster.toLowerCase() === id)
}

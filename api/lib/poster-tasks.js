/** Poster task list directly from the canonical Base TaskRegistry. */
import { listRecentTaskRows } from "./base-tasks.js";

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

export async function getPosterTasks(address) {
  const id = normAddr(address);
  if (!id) throw new Error("Wallet address required");

  const tasks = await listRecentTaskRows(100, (task) => task.poster.toLowerCase() === id);
  return tasks.map(({ poster, ...task }) => task);
}

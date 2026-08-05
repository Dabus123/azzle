/** Poster task list from the authoritative Base RPC reader. */
import { listTasks } from "./tasks-rpc.js";

function normAddr(addr) {
  if (!addr || typeof addr !== "string") return "";
  return addr.trim().toLowerCase();
}

export async function getPosterTasks(address) {
  const id = normAddr(address);
  if (!id) throw new Error("Wallet address required");

  return (await listTasks({ limit: 100, poster: id })).tasks;
}

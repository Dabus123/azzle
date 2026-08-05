/** Recent tasks across all states from the authoritative Base RPC reader. */
import { listTasks } from "./tasks-rpc.js";

export async function getRecentTasks(limit = 50) {
  return (await listTasks({ limit })).tasks;
}

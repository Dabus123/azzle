/** POSTED (claimable) tasks from the authoritative Base RPC reader. */
import { listTasks } from "./tasks-rpc.js";

export async function getOpenTasks(limit = 100) {
  return (await listTasks({ limit, state: "POSTED" })).tasks;
}

/** POSTED (claimable) tasks directly from the Base TaskRegistry. */
import { listRecentTaskRows } from "./base-tasks.js";

export async function getOpenTasks(limit = 100) {
  return listRecentTaskRows(limit, (task) => task.state === "POSTED");
}

/** Recent tasks across all states directly from the Base TaskRegistry. */
import { listRecentTaskRows } from "./base-tasks.js";

export async function getRecentTasks(limit = 50) {
  return listRecentTaskRows(limit);
}

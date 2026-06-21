import type { PostgresStore } from "./graph/postgres.js";
import {
  computeFunnelStats,
  formatFunnelReport,
  type FunnelStats,
} from "./discovery/contact-utils.js";

export type { FunnelStats };

export async function getFunnelStats(
  store: PostgresStore,
  threshold: number,
  scoreType = "azzle_probability"
): Promise<FunnelStats> {
  return store.getFunnelStats(threshold, scoreType);
}

export async function printFunnelReport(
  store: PostgresStore,
  threshold: number
): Promise<FunnelStats> {
  const stats = await getFunnelStats(store, threshold);
  console.log(formatFunnelReport(stats, threshold));
  return stats;
}

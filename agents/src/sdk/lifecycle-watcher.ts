import type { AzzleV2Client } from "./client-v2.js";

export type LifecycleEvent =
  | "funding-expiring"
  | "deadline-expiring"
  | "delivery-grace-elapsed"
  | "dispute-window-open"
  | "action-required";

export interface LifecycleObservation {
  taskId: bigint;
  state: string;
  event: LifecycleEvent;
  action: "fund" | "mark-delivered" | "release" | "expire" | "open-dispute" | "none";
  at: number;
}

export interface LifecycleWatcherOptions {
  intervalMs?: number;
  now?: () => number;
  onObservation?: (observation: LifecycleObservation) => void | Promise<void>;
}

const STATE_NAMES = ["NONE", "POSTED", "CLAIMED", "ACTIVE", "DISPUTED", "COMPLETED", "CANCELLED", "RESOLVED"];

export class LifecycleWatcher {
  private timer?: ReturnType<typeof setInterval>;
  private readonly seen = new Set<string>();
  private readonly intervalMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: AzzleV2Client,
    private readonly options: LifecycleWatcherOptions = {},
  ) {
    this.intervalMs = Math.max(options.intervalMs ?? 30_000, 5_000);
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async inspect(taskId: bigint): Promise<LifecycleObservation[]> {
    const row = await this.client.getTask(taskId);
    const now = this.now();
    const state = STATE_NAMES[row.state] ?? `UNKNOWN(${row.state})`;
    const observations: LifecycleObservation[] = [];
    const add = (event: LifecycleEvent, action: LifecycleObservation["action"], at: number) => {
      const key = `${taskId}:${event}:${at}`;
      if (this.seen.has(key)) return;
      this.seen.add(key);
      observations.push({ taskId, state, event, action, at });
    };
    if (state === "CLAIMED" && row.fundingDeadline > 0n && Number(row.fundingDeadline) <= now + 3600) {
      add("funding-expiring", "fund", Number(row.fundingDeadline));
    }
    if (["CLAIMED", "ACTIVE"].includes(state) && Number(row.deadline) <= now + 3600) {
      add("deadline-expiring", "expire", Number(row.deadline));
    }
    if (state === "ACTIVE" && row.deliveredAt > 0n) {
      const graceEnds = Number(row.deliveredAt) + 86_400;
      if (graceEnds <= now) add("delivery-grace-elapsed", "release", graceEnds);
      else add("dispute-window-open", "open-dispute", Number(row.deliveredAt));
    }
    if (state === "ACTIVE" && row.deliveredAt === 0n) add("action-required", "mark-delivered", now);
    if (this.options.onObservation) {
      for (const observation of observations) await this.options.onObservation(observation);
    }
    return observations;
  }

  start(taskIds: bigint[]) {
    void Promise.all(taskIds.map((taskId) => this.inspect(taskId)));
    this.timer = setInterval(() => void Promise.all(taskIds.map((taskId) => this.inspect(taskId))), this.intervalMs);
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}

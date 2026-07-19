export interface BaseRpcTask {
  id: string;
  state: string;
  poster: { id: string };
  worker: { id: string } | null;
  escrowAmount: string;
  createdAt: string;
}

export class AzzleBaseRpc {
  constructor(private readonly endpoint = "https://www.azzle.org") {}

  async getOpenTasks(limit = 50): Promise<BaseRpcTask[]> {
    const res = await fetch(`${this.endpoint.replace(/\/$/, "")}/api/market/open?limit=${encodeURIComponent(String(limit))}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { tasks?: BaseRpcTask[] };
    return json.tasks ?? [];
  }

  async getTopAgents(_limit = 20): Promise<Array<{ id: string; reputationScore: string; tasksCompleted: number }>> {
    return [];
  }
}

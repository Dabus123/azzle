export interface SubgraphTask {
  id: string;
  state: string;
  poster: { id: string };
  worker: { id: string } | null;
  escrowAmount: string;
  createdAt: string;
}

export class AzzleSubgraph {
  constructor(private endpoint: string) {}

  async getOpenTasks(limit = 50): Promise<SubgraphTask[]> {
    const query = `
      query($limit: Int!) {
        tasks(
          first: $limit
          orderBy: createdAt
          orderDirection: desc
          where: { state: "POSTED" }
        ) {
          id state escrowAmount createdAt
          poster { id }
          worker { id }
        }
      }`;
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { limit } }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { tasks?: SubgraphTask[] } };
    return json.data?.tasks ?? [];
  }

  async getTopAgents(limit = 20): Promise<
    Array<{ id: string; reputationScore: string; tasksCompleted: number }>
  > {
    const query = `
      query($limit: Int!) {
        agents(first: $limit, orderBy: reputationScore, orderDirection: desc) {
          id reputationScore tasksCompleted
        }
      }`;
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { limit } }),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { agents?: Array<{ id: string; reputationScore: string; tasksCompleted: number }> };
    };
    return json.data?.agents ?? [];
  }
}

/**
 * Query the public Azzle subgraph (The Graph Studio) instead of scanning RPC logs.
 * Override with AZZLE_SUBGRAPH_URL when using a different Studio version label.
 */

export const DEFAULT_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.1";

export interface SubgraphTask {
  id: string;
  state: string;
  poster: { id: string };
  worker: { id: string } | null;
  escrowAmount: string;
  createdAt: string;
  updatedAt: string;
  settlementDigest: string | null;
}

export interface SubgraphAgent {
  id: string;
  reputationScore: string;
  tasksCompleted: number;
  disputesWon: number;
  disputesLost: number;
  verifierBondEth: string;
  signals: Array<{
    id: string;
    signalType: string;
    weight: string;
    emittedAt: string;
    taskId: string;
  }>;
}

export interface SubgraphIndexerConfig {
  /** GraphQL HTTP endpoint from The Graph Studio */
  subgraphUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SubgraphIndexer {
  private readonly url: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: SubgraphIndexerConfig = {}) {
    this.url =
      config.subgraphUrl ??
      process.env.AZZLE_SUBGRAPH_URL ??
      DEFAULT_SUBGRAPH_URL;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  private async query<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: document, variables }),
    });
    if (!res.ok) {
      throw new Error(`SubgraphIndexer: HTTP ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (json.errors?.length) {
      throw new Error(`SubgraphIndexer: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (!json.data) {
      throw new Error("SubgraphIndexer: empty response");
    }
    return json.data;
  }

  /** All tasks in POSTED state (claimable on the search market). */
  async getOpenTasks(): Promise<SubgraphTask[]> {
    const data = await this.query<{ tasks: SubgraphTask[] }>(`
      query OpenTasks {
        tasks(where: { state: "POSTED" }, orderBy: createdAt, orderDirection: desc) {
          id
          state
          escrowAmount
          createdAt
          updatedAt
          settlementDigest
          poster { id }
          worker { id }
        }
      }
    `);
    return data.tasks;
  }

  /** Aggregated reputation and signal history for an agent address. */
  async getAgentReputation(address: string): Promise<SubgraphAgent | null> {
    const id = address.toLowerCase();
    const data = await this.query<{ agent: SubgraphAgent | null }>(`
      query AgentReputation($id: ID!) {
        agent(id: $id) {
          id
          reputationScore
          tasksCompleted
          disputesWon
          disputesLost
          verifierBondEth
          signals(orderBy: emittedAt, orderDirection: desc, first: 100) {
            id
            signalType
            weight
            emittedAt
            taskId
          }
        }
      }
    `, { id });
    return data.agent;
  }

  /** Full task row by on-chain task id. */
  async getTask(taskId: string | bigint): Promise<SubgraphTask | null> {
    const id = taskId.toString();
    const data = await this.query<{ task: SubgraphTask | null }>(`
      query TaskById($id: ID!) {
        task(id: $id) {
          id
          state
          escrowAmount
          createdAt
          updatedAt
          settlementDigest
          poster { id }
          worker { id }
        }
      }
    `, { id });
    return data.task;
  }
}

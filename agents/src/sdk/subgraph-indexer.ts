/**
 * Query the public Azzle subgraph (The Graph Studio) instead of scanning RPC logs.
 * Override with AZZLE_SUBGRAPH_URL when using a different Studio version label.
 */

export const DEFAULT_SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

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
  /** Active GraphQL endpoint (Studio version label). */
  readonly endpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: SubgraphIndexerConfig = {}) {
    this.endpoint =
      config.subgraphUrl ??
      process.env.AZZLE_SUBGRAPH_URL ??
      DEFAULT_SUBGRAPH_URL;
    this.fetchFn = config.fetchImpl ?? fetch;
  }

  private async query<T>(document: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(this.endpoint, {
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

  /** Top agents by on-chain reputation score (evidence layer). */
  async getTopAgents(limit = 25): Promise<SubgraphAgent[]> {
    const data = await this.query<{ agents: SubgraphAgent[] }>(`
      query TopAgents($first: Int!) {
        agents(
          first: $first
          orderBy: reputationScore
          orderDirection: desc
          where: { reputationScore_gt: "0" }
        ) {
          id
          reputationScore
          tasksCompleted
          disputesWon
          disputesLost
          verifierBondEth
        }
      }
    `, { first: limit });
    return data.agents;
  }

  /** Agents with staked verifier bonds (ETH), sorted by bond size. */
  async getVerifierLeaderboard(limit = 25): Promise<SubgraphAgent[]> {
    const data = await this.query<{ agents: SubgraphAgent[] }>(`
      query VerifierLeaderboard($first: Int!) {
        agents(
          first: $first
          orderBy: verifierBondEth
          orderDirection: desc
          where: { verifierBondEth_gt: "0" }
        ) {
          id
          reputationScore
          tasksCompleted
          disputesWon
          disputesLost
          verifierBondEth
        }
      }
    `, { first: limit });
    return data.agents;
  }

  /** Recent tasks across all states (market pulse). */
  async getRecentTasks(limit = 50): Promise<SubgraphTask[]> {
    const data = await this.query<{ tasks: SubgraphTask[] }>(`
      query RecentTasks($first: Int!) {
        tasks(first: $first, orderBy: createdAt, orderDirection: desc) {
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
    `, { first: limit });
    return data.tasks;
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

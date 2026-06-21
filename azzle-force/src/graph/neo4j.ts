import neo4j, { type Driver } from "neo4j-driver";

export class Neo4jStore {
  private driver: Driver;

  constructor(uri: string, user: string, password: string) {
    this.driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }

  async verify(): Promise<void> {
    await this.driver.verifyAuthentication();
  }

  async upsertNode(
    id: string,
    labels: string[],
    properties: Record<string, unknown>
  ): Promise<void> {
    const labelClause = labels.map((l) => `:${l}`).join("");
    const session = this.driver.session();
    try {
      await session.run(
        `MERGE (n${labelClause} {id: $id})
         SET n += $props, n.updated_at = datetime()`,
        { id, props: { ...properties, id } }
      );
    } finally {
      await session.close();
    }
  }

  async createRelationship(
    fromId: string,
    toId: string,
    type: string,
    properties: Record<string, unknown> = {}
  ): Promise<void> {
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (a {id: $fromId}), (b {id: $toId})
         MERGE (a)-[r:${type}]->(b)
         SET r += $props`,
        { fromId, toId, props: properties }
      );
    } finally {
      await session.close();
    }
  }

  async getEntitySlice(entityId: string): Promise<Record<string, unknown>> {
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (n {id: $id})
         OPTIONAL MATCH (n)-[r]-(m)
         RETURN n, collect({rel: type(r), node: m}) AS neighbors`,
        { id: entityId }
      );
      if (res.records.length === 0) return { id: entityId, neighbors: [] };
      const node = res.records[0].get("n").properties;
      const neighbors = res.records[0].get("neighbors");
      return { ...node, neighbors };
    } finally {
      await session.close();
    }
  }

  async countNodes(): Promise<number> {
    const session = this.driver.session();
    try {
      const res = await session.run("MATCH (n) RETURN count(n) AS c");
      return res.records[0]?.get("c")?.toNumber?.() ?? 0;
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

export function labelForType(type: string): string {
  const map: Record<string, string> = {
    person: "Person",
    company: "Company",
    agent: "Agent",
    protocol: "Protocol",
    dao: "DAO",
    repository: "Repository",
    task: "Task",
    community: "Community",
    market: "Market",
  };
  return map[type] ?? "Entity";
}

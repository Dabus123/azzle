import type { LiteStore } from "./store.js";

/** Postgres API surface used by agents + GraphWriter */
export class LitePostgresStore {
  constructor(private store: LiteStore) {}

  async migrate(): Promise<void> {
    await this.store.migrate();
  }

  async upsertEntity(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {},
    id?: string
  ): Promise<string> {
    return this.store.upsertEntity(type, name, metadata, id);
  }

  async getEntity(id: string): Promise<Record<string, unknown> | null> {
    const row = await this.store.getEntity(id);
    return row as unknown as Record<string, unknown> | null;
  }

  async countEntities(): Promise<number> {
    return this.store.countEntities();
  }

  async listEntities(limit = 100, type?: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.listEntities(limit, type);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async listEntitiesNeedingContactEnrichment(
    limit = 50,
    scoreType = "azzle_probability"
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.listEntitiesNeedingContactEnrichment(limit, scoreType);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async listUnscoredEntities(
    limit = 50,
    scoreType = "azzle_probability"
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.listUnscoredEntities(limit, scoreType);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async getFunnelStats(threshold: number, scoreType = "azzle_probability") {
    return this.store.getFunnelStats(threshold, scoreType);
  }

  async upsertScore(
    entityId: string,
    scoreType: string,
    value: number,
    reason?: string
  ): Promise<void> {
    await this.store.upsertScore(entityId, scoreType, value, reason);
  }

  async topScoredEntities(scoreType: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.topScoredEntities(scoreType, limit);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async topScoredContactableEntities(
    scoreType: string,
    minScore: number,
    limit = 50,
    emailOnly = false
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.topScoredContactableEntities(
      scoreType,
      minScore,
      limit,
      emailOnly
    );
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async createMission(
    agentType: string,
    targetEntityId?: string,
    payload: Record<string, unknown> = {}
  ): Promise<string> {
    return this.store.createMission(agentType, targetEntityId, payload);
  }

  async listPendingMissions(agentType: string): Promise<Array<Record<string, unknown>>> {
    const rows = await this.store.listPendingMissions(agentType);
    return rows as unknown as Array<Record<string, unknown>>;
  }

  async completeMission(id: string): Promise<void> {
    await this.store.completeMission(id);
  }

  async logOutreach(
    entityId: string,
    channel: string,
    status: string,
    opts?: string | { contentHash?: string; subject?: string; body?: string }
  ): Promise<string> {
    return this.store.logOutreach(entityId, channel, status, opts);
  }

  async getLatestOutreach(
    entityId: string,
    statuses?: string[]
  ): Promise<Record<string, unknown> | null> {
    const row = await this.store.getLatestOutreach(entityId, statuses);
    return row as unknown as Record<string, unknown> | null;
  }

  async entitiesWithLatestOutreachStatus(status: string): Promise<string[]> {
    return this.store.entitiesWithLatestOutreachStatus(status);
  }

  async logAudit(
    agent: string,
    eventType: string,
    payload: Record<string, unknown>,
    entityId?: string
  ): Promise<void> {
    await this.store.logAudit(agent, eventType, payload, entityId);
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}

export class LiteNeo4jStore {
  constructor(private store: LiteStore) {}

  async verify(): Promise<void> {
    /* lite — always ok */
  }

  async upsertNode(
    id: string,
    labels: string[],
    properties: Record<string, unknown>
  ): Promise<void> {
    await this.store.upsertNode(id, labels, properties);
  }

  async createRelationship(
    fromId: string,
    toId: string,
    type: string,
    properties: Record<string, unknown> = {}
  ): Promise<void> {
    await this.store.createRelationship(fromId, toId, type, properties);
  }

  async getEntitySlice(entityId: string): Promise<Record<string, unknown>> {
    return this.store.getEntitySlice(entityId);
  }

  async countNodes(): Promise<number> {
    return this.store.countNodes();
  }

  async close(): Promise<void> {
    await this.store.close();
  }
}

type VectorCollection = "repositories" | "communities" | "outreach" | "entities";

export class LiteQdrantStore {
  constructor(private store: LiteStore) {}

  async initCollections(): Promise<void> {
    await this.store.initCollections();
  }

  embedText(text: string, dim?: number): number[] {
    return this.store.embedText(text, dim);
  }

  async upsert(
    collection: VectorCollection,
    entityId: string,
    text: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    await this.store.upsertVector(collection, entityId, text, payload);
  }

  async search(
    collection: VectorCollection,
    text: string,
    limit = 5
  ): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
    return this.store.searchVectors(collection, text, limit);
  }
}

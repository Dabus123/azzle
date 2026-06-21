import { v4 as uuidv4 } from "uuid";

import pg from "pg";
import {
  computeFunnelStats,
  entityNeedsContactEnrichment,
  hasReachableContact,
  type FunnelStats,
} from "../discovery/contact-utils.js";

const { Pool } = pg;

export class PostgresStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS entities (
          id UUID PRIMARY KEY,
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          metadata JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS missions (
          id UUID PRIMARY KEY,
          agent_type TEXT NOT NULL,
          target_entity_id UUID,
          status TEXT NOT NULL DEFAULT 'pending',
          payload JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS outreach_events (
          id UUID PRIMARY KEY,
          entity_id UUID NOT NULL,
          channel TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          content_hash TEXT,
          subject TEXT,
          body TEXT,
          sent_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS scores (
          entity_id UUID NOT NULL,
          score_type TEXT NOT NULL,
          value DOUBLE PRECISION NOT NULL,
          computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          reason TEXT,
          PRIMARY KEY (entity_id, score_type)
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id UUID PRIMARY KEY,
          entity_id UUID,
          agent TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        ALTER TABLE outreach_events ADD COLUMN IF NOT EXISTS subject TEXT;
        ALTER TABLE outreach_events ADD COLUMN IF NOT EXISTS body TEXT;
      `);
    } finally {
      client.release();
    }
  }

  async upsertEntity(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {},
    id?: string
  ): Promise<string> {
    const entityId = id ?? uuidv4();
    await this.pool.query(
      `INSERT INTO entities (id, type, name, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         metadata = entities.metadata || EXCLUDED.metadata,
         updated_at = NOW()`,
      [entityId, type, name, JSON.stringify(metadata)]
    );
    return entityId;
  }

  async getEntity(id: string) {
    const res = await this.pool.query("SELECT * FROM entities WHERE id = $1", [id]);
    return res.rows[0] ?? null;
  }

  async countEntities(): Promise<number> {
    const res = await this.pool.query("SELECT COUNT(*)::int AS c FROM entities");
    return res.rows[0]?.c ?? 0;
  }

  async listEntities(limit = 100, type?: string) {
    const res = type
      ? await this.pool.query(
          "SELECT * FROM entities WHERE type = $1 ORDER BY updated_at DESC LIMIT $2",
          [type, limit]
        )
      : await this.pool.query("SELECT * FROM entities ORDER BY updated_at DESC LIMIT $1", [
          limit,
        ]);
    return res.rows;
  }

  /** High-score entities with a GitHub owner but no sendable contact yet. */
  async listEntitiesNeedingContactEnrichment(
    limit = 50,
    scoreType = "azzle_probability"
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.pool.query(
      `SELECT e.*, COALESCE(s.value, 0) AS score_value
       FROM entities e
       LEFT JOIN scores s ON s.entity_id = e.id AND s.score_type = $1
       WHERE COALESCE(e.metadata->>'contact_enrichment_attempted', '') IS DISTINCT FROM 'true'
       ORDER BY COALESCE(s.value, 0) DESC, e.updated_at DESC`,
      [scoreType]
    );
    const out: Array<Record<string, unknown>> = [];
    for (const row of res.rows as Array<Record<string, unknown>>) {
      if (!entityNeedsContactEnrichment(row as { name?: string; metadata?: Record<string, unknown> })) {
        continue;
      }
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Entities not yet scored — prioritize those with a resolvable GitHub owner. */
  async listUnscoredEntities(
    limit = 50,
    scoreType = "azzle_probability"
  ): Promise<Array<Record<string, unknown>>> {
    const res = await this.pool.query(
      `SELECT e.* FROM entities e
       LEFT JOIN scores s ON s.entity_id = e.id AND s.score_type = $1
       WHERE s.entity_id IS NULL
       ORDER BY (e.metadata->>'owner' IS NOT NULL) DESC, e.updated_at DESC
       LIMIT $2`,
      [scoreType, limit]
    );
    return res.rows;
  }

  async getFunnelStats(
    threshold: number,
    scoreType = "azzle_probability"
  ): Promise<FunnelStats> {
    const [entities, scores, outreach] = await Promise.all([
      this.pool.query("SELECT id, name, metadata FROM entities"),
      this.pool.query("SELECT entity_id, score_type, value FROM scores WHERE score_type = $1", [
        scoreType,
      ]),
      this.pool.query(
        "SELECT entity_id, status, created_at FROM outreach_events ORDER BY created_at"
      ),
    ]);
    return computeFunnelStats(
      entities.rows as Array<{ id: string; name?: string; metadata?: Record<string, unknown> }>,
      scores.rows as Array<{ entity_id: string; score_type: string; value: number }>,
      outreach.rows as Array<{ entity_id: string; status: string; created_at?: string }>,
      threshold,
      scoreType
    );
  }

  async upsertScore(
    entityId: string,
    scoreType: string,
    value: number,
    reason?: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO scores (entity_id, score_type, value, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (entity_id, score_type) DO UPDATE SET
         value = EXCLUDED.value,
         reason = EXCLUDED.reason,
         computed_at = NOW()`,
      [entityId, scoreType, value, reason]
    );
  }

  async topScoredEntities(scoreType: string, limit = 50) {
    const res = await this.pool.query(
      `SELECT e.*, s.value AS score_value, s.reason AS score_reason
       FROM scores s JOIN entities e ON e.id = s.entity_id
       WHERE s.score_type = $1
       ORDER BY s.value DESC LIMIT $2`,
      [scoreType, limit]
    );
    return res.rows;
  }

  async topScoredContactableEntities(scoreType: string, minScore: number, limit = 50, emailOnly = false) {
    const res = await this.pool.query(
      `SELECT e.*, s.value AS score_value, s.reason AS score_reason
       FROM scores s JOIN entities e ON e.id = s.entity_id
       WHERE s.score_type = $1 AND s.value >= $2
       ORDER BY s.value DESC`,
      [scoreType, minScore]
    );
    const out: Record<string, unknown>[] = [];
    for (const row of res.rows as Array<Record<string, unknown>>) {
      const meta = row.metadata as Record<string, unknown> | undefined;
      if (!hasReachableContact(meta ?? {})) continue;
      const cm = meta?.contact_methods;
      if (!Array.isArray(cm)) continue;
      const hasEmail = cm.some((c) => {
        const m = /^email:([^\s]+)$/i.exec(String(c).trim());
        return m != null;
      });
      const hasX = cm.some((c) => /^x:/i.test(String(c)));
      const reachable = emailOnly ? hasEmail : hasEmail || hasX;
      if (!reachable) continue;
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  }

  async createMission(
    agentType: string,
    targetEntityId?: string,
    payload: Record<string, unknown> = {}
  ): Promise<string> {
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO missions (id, agent_type, target_entity_id, status, payload)
       VALUES ($1, $2, $3, 'pending', $4)`,
      [id, agentType, targetEntityId, JSON.stringify(payload)]
    );
    return id;
  }

  async listPendingMissions(agentType: string) {
    const res = await this.pool.query(
      `SELECT * FROM missions WHERE agent_type = $1 AND status = 'pending' ORDER BY created_at`,
      [agentType]
    );
    return res.rows;
  }

  async completeMission(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE missions SET status = 'completed', updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  async logOutreach(
    entityId: string,
    channel: string,
    status: string,
    opts?: string | { contentHash?: string; subject?: string; body?: string }
  ): Promise<string> {
    const options =
      typeof opts === "string" ? { contentHash: opts } : (opts ?? {});
    const id = uuidv4();
    await this.pool.query(
      `INSERT INTO outreach_events (id, entity_id, channel, status, content_hash, subject, body, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END)`,
      [
        id,
        entityId,
        channel,
        status,
        options.contentHash,
        options.subject,
        options.body,
      ]
    );
    return id;
  }

  async getLatestOutreach(
    entityId: string,
    statuses?: string[]
  ): Promise<Record<string, unknown> | null> {
    const allowed = statuses ?? ["draft", "pending_approval"];
    const res = await this.pool.query(
      `SELECT id, entity_id, channel, status, content_hash, subject, body, sent_at, created_at
       FROM outreach_events
       WHERE entity_id = $1 AND status = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [entityId, allowed]
    );
    return (res.rows[0] as Record<string, unknown>) ?? null;
  }

  async entitiesWithLatestOutreachStatus(status: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT entity_id FROM (
         SELECT DISTINCT ON (entity_id) entity_id, status
         FROM outreach_events
         ORDER BY entity_id, created_at DESC
       ) latest
       WHERE status = $1`,
      [status]
    );
    return res.rows.map((r) => String(r.entity_id));
  }

  async logAudit(
    agent: string,
    eventType: string,
    payload: Record<string, unknown>,
    entityId?: string
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_events (id, entity_id, agent, event_type, payload)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv4(), entityId, agent, eventType, JSON.stringify(payload)]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

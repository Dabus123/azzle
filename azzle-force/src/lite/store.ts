import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { v4 as uuidv4 } from "uuid";
import {
  computeFunnelStats,
  entityNeedsContactEnrichment,
  hasReachableContact,
  resolveOwnerFromMetadata,
  type FunnelStats,
} from "../discovery/contact-utils.js";

const __dir = dirname(fileURLToPath(import.meta.url));

interface LiteData {
  entities: Record<string, EntityRow>;
  missions: Record<string, MissionRow>;
  outreach_events: Record<string, OutreachRow>;
  scores: Record<string, ScoreRow>;
  audit_events: AuditRow[];
  nodes: Record<string, NodeRow>;
  relationships: RelRow[];
  vectors: Record<string, VectorRow>;
}

interface EntityRow {
  id: string;
  type: string;
  name: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface MissionRow {
  id: string;
  agent_type: string;
  target_entity_id?: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface OutreachRow {
  id: string;
  entity_id: string;
  channel: string;
  status: string;
  content_hash?: string;
  subject?: string;
  body?: string;
  failure_reason?: string;
  sent_at?: string;
  created_at: string;
}

export interface OutreachLogOptions {
  contentHash?: string;
  subject?: string;
  body?: string;
  failureReason?: string;
}

interface ScoreRow {
  entity_id: string;
  score_type: string;
  value: number;
  computed_at: string;
  reason?: string;
}

interface AuditRow {
  id: string;
  entity_id?: string;
  agent: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface NodeRow {
  id: string;
  labels: string[];
  properties: Record<string, unknown>;
  updated_at: string;
}

interface RelRow {
  fromId: string;
  toId: string;
  type: string;
  properties: Record<string, unknown>;
}

interface VectorRow {
  collection: string;
  entityId: string;
  vector: number[];
  payload: Record<string, unknown>;
}

function emptyData(): LiteData {
  return {
    entities: {},
    missions: {},
    outreach_events: {},
    scores: {},
    audit_events: [],
    nodes: {},
    relationships: [],
    vectors: {},
  };
}

export class LiteStore {
  private data: LiteData;
  private readonly filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;
  private lastWrittenJson = "";
  private lastArchiveAt = 0;
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    const dir = dataDir ?? resolve(__dir, "..", "..", ".azzle-force-lite");
    this.dataDir = dir;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    mkdirSync(resolve(dir, "archives"), { recursive: true });
    this.filePath = resolve(dir, "graph.json");
    this.data = this.load();
    this.autosaveTimer = setInterval(() => this.saveNow(), 15_000);
  }

  getFilePath(): string {
    return this.filePath;
  }

  private load(): LiteData {
    const paths = this.allGraphPaths();
    let best: LiteData | null = null;
    let bestCount = 0;
    let bestPath = "";

    for (const path of paths) {
      if (!existsSync(path)) continue;
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) continue;
      try {
        const data = normalizeData(JSON.parse(raw) as LiteData);
        const n = Object.keys(data.entities).length;
        if (n > bestCount) {
          best = data;
          bestCount = n;
          bestPath = path;
        }
      } catch {
        /* skip corrupt */
      }
    }

    if (best && bestCount > 0) {
      console.log(`[lite] loaded ${bestCount} entities from ${bestPath}`);
      return best;
    }

    console.warn(`[lite] no valid graph file — starting empty`);
    return emptyData();
  }

  private allGraphPaths(): string[] {
    const paths = new Set<string>();
    const add = (p: string) => paths.add(p);

    add(this.filePath);
    add(this.snapshotPath());
    add(this.filePath + ".bak");
    add(this.filePath + ".tmp");

    const archDir = resolve(this.dataDir, "archives");
    if (existsSync(archDir)) {
      for (const name of readdirSync(archDir)) {
        if (name.endsWith(".json")) add(resolve(archDir, name));
      }
    }

    return [...paths];
  }

  private archivesDir(): string {
    return resolve(this.dataDir, "archives");
  }

  private entityCountFromFile(path: string): number {
    if (!existsSync(path)) return 0;
    try {
      const raw = readFileSync(path, "utf8").trim();
      if (!raw) return 0;
      const d = JSON.parse(raw) as LiteData;
      return Object.keys(d.entities ?? {}).length;
    } catch {
      return 0;
    }
  }

  private buildDiskPayload(): LiteData {
    return {
      entities: this.data.entities,
      missions: this.data.missions,
      outreach_events: this.data.outreach_events,
      scores: this.data.scores,
      audit_events: [],
      nodes: this.data.nodes,
      relationships: this.data.relationships.slice(-2000),
      vectors: {},
    };
  }

  private writeVerified(path: string, json: string): void {
    JSON.parse(json);
    writeFileSync(path, json, "utf8");
  }

  private maybeArchive(json: string, entityCount: number): void {
    const now = Date.now();
    if (entityCount < 10 || now - this.lastArchiveAt < 5 * 60_000) return;
    this.lastArchiveAt = now;
    const archDir = this.archivesDir();
    const archPath = resolve(archDir, `graph-${entityCount}-${now}.json`);
    this.writeVerified(archPath, json);
    const files = readdirSync(archDir)
      .filter((f) => f.startsWith("graph-") && f.endsWith(".json"))
      .map((f) => ({ name: f, size: readFileSync(resolve(archDir, f)).length }))
      .sort((a, b) => b.size - a.size);
    for (const f of files.slice(8)) {
      try {
        unlinkSync(resolve(archDir, f.name));
      } catch {
        /* ignore */
      }
    }
  }

  private snapshotPath(): string {
    return this.filePath.replace(/\.json$/, ".snapshot.json");
  }

  private loadBackup(): LiteData | null {
    const bak = this.filePath + ".bak";
    if (!existsSync(bak)) return null;
    try {
      return normalizeData(JSON.parse(readFileSync(bak, "utf8")) as LiteData);
    } catch {
      return null;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 2000);
  }

  /** Persist graph — verified JSON, snapshot-first, never regress entity count on disk */
  private saveNow(): void {
    const payload = this.buildDiskPayload();
    const entityCount = Object.keys(payload.entities).length;
    const json = JSON.stringify(payload);
    if (json === this.lastWrittenJson) return;

    const snapshot = this.snapshotPath();
    const tmp = this.filePath + ".tmp";

    try {
      this.writeVerified(tmp, json);

      const prevSnap = this.entityCountFromFile(snapshot);
      if (entityCount >= prevSnap) {
        this.writeVerified(snapshot, json);
        this.maybeArchive(json, entityCount);
      } else {
        console.warn(
          `[lite] snapshot skip — in-memory ${entityCount} < snapshot ${prevSnap} (disk not regressed)`
        );
      }

      if (existsSync(this.filePath) && !this.isCorruptFile()) {
        const prevMain = this.entityCountFromFile(this.filePath);
        if (entityCount >= prevMain) {
          try {
            writeFileSync(this.filePath + ".bak", readFileSync(this.filePath, "utf8"), "utf8");
          } catch {
            /* locked */
          }
        }
      }

      try {
        renameSync(tmp, this.filePath);
      } catch {
        writeFileSync(this.filePath, json, "utf8");
        try {
          unlinkSync(tmp);
        } catch {
          /* ignore */
        }
      }
      this.lastWrittenJson = json;
    } catch (err) {
      console.error(`[lite] failed to save graph:`, err);
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  private backupNow(): void {
    if (!existsSync(this.filePath)) return;
    try {
      writeFileSync(this.filePath + ".bak", readFileSync(this.filePath, "utf8"), "utf8");
    } catch {
      /* optional */
    }
  }

  async migrate(): Promise<void> {
    const n = Object.keys(this.data.entities).length;
    if (n > 0) {
      this.saveNow();
    } else if (!existsSync(this.filePath) && !existsSync(this.snapshotPath())) {
      this.data = emptyData();
      this.saveNow();
    }
    const after = Object.keys(this.data.entities).length;
    console.log(`[lite] graph ready at ${this.filePath} (${after} entities)`);
  }

  private isCorruptFile(): boolean {
    if (!existsSync(this.filePath)) return false;
    try {
      const raw = readFileSync(this.filePath, "utf8").trim();
      if (!raw) return true;
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  }

  private isCorruptSnapshot(): boolean {
    const snap = this.snapshotPath();
    if (!existsSync(snap)) return true;
    try {
      const raw = readFileSync(snap, "utf8").trim();
      if (!raw) return true;
      JSON.parse(raw);
      return false;
    } catch {
      return true;
    }
  }

  private findEntityId(type: string, name: string): string | undefined {
    return Object.values(this.data.entities).find(
      (e) => e.type === type && e.name === name
    )?.id;
  }

  private stableEntityId(type: string, name: string): string {
    const hash = createHash("sha256").update(`${type}:${name}`).digest("hex");
    return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
  }

  async upsertEntity(
    type: string,
    name: string,
    metadata: Record<string, unknown> = {},
    id?: string
  ): Promise<string> {
    const entityId =
      id ?? this.findEntityId(type, name) ?? this.stableEntityId(type, name);
    const existing = this.data.entities[entityId];
    const now = new Date().toISOString();
    this.data.entities[entityId] = {
      id: entityId,
      type,
      name,
      metadata: { ...(existing?.metadata ?? {}), ...metadata },
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.scheduleSave();
    return entityId;
  }

  async getEntity(id: string) {
    return this.data.entities[id] ?? null;
  }

  async countEntities(): Promise<number> {
    return Object.keys(this.data.entities).length;
  }

  async listEntities(limit = 100, type?: string) {
    let rows = Object.values(this.data.entities);
    if (type) rows = rows.filter((e) => e.type === type);
    rows.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return rows.slice(0, limit);
  }

  async listEntitiesNeedingContactEnrichment(
    limit = 50,
    scoreType = "azzle_probability"
  ): Promise<EntityRow[]> {
    const scoreMap = new Map<string, number>();
    for (const s of Object.values(this.data.scores)) {
      if (s.score_type === scoreType) scoreMap.set(s.entity_id, s.value);
    }

    return Object.values(this.data.entities)
      .filter((e) => entityNeedsContactEnrichment(e))
      .sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0))
      .slice(0, limit);
  }

  async listUnscoredEntities(limit = 50, scoreType = "azzle_probability"): Promise<EntityRow[]> {
    const scored = new Set(
      Object.values(this.data.scores)
        .filter((s) => s.score_type === scoreType)
        .map((s) => s.entity_id)
    );

    return Object.values(this.data.entities)
      .filter((e) => !scored.has(e.id))
      .sort((a, b) => {
        const aOwner = resolveOwnerFromMetadata(a.metadata ?? {}, a.name).owner ? 1 : 0;
        const bOwner = resolveOwnerFromMetadata(b.metadata ?? {}, b.name).owner ? 1 : 0;
        return bOwner - aOwner || b.updated_at.localeCompare(a.updated_at);
      })
      .slice(0, limit);
  }

  async getFunnelStats(threshold: number, scoreType = "azzle_probability"): Promise<FunnelStats> {
    return computeFunnelStats(
      Object.values(this.data.entities),
      Object.values(this.data.scores),
      Object.values(this.data.outreach_events),
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
    const key = `${entityId}:${scoreType}`;
    this.data.scores[key] = {
      entity_id: entityId,
      score_type: scoreType,
      value,
      computed_at: new Date().toISOString(),
      reason,
    };
    this.scheduleSave();
  }

  async topScoredEntities(scoreType: string, limit = 50) {
    const rows = Object.values(this.data.scores)
      .filter((s) => s.score_type === scoreType)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit)
      .map((s) => {
        const e = this.data.entities[s.entity_id];
        if (!e) return null;
        return {
          ...e,
          score_value: s.value,
          score_reason: s.reason,
        };
      })
      .filter(Boolean);
    return rows as Array<EntityRow & { score_value: number; score_reason?: string }>;
  }

  async topScoredContactableEntities(scoreType: string, minScore: number, limit = 50, emailOnly = false) {
    const rows = Object.values(this.data.scores)
      .filter((s) => s.score_type === scoreType && s.value >= minScore)
      .sort((a, b) => b.value - a.value);

    const out: Array<EntityRow & { score_value: number; score_reason?: string }> = [];
    for (const s of rows) {
      const e = this.data.entities[s.entity_id];
      if (!e) continue;
      const meta = e.metadata ?? {};
      if (!hasReachableContact(meta)) continue;
      const cm = meta.contact_methods;
      if (!Array.isArray(cm)) continue;
      const hasEmail = cm.some((c) => /^email:/i.test(String(c)));
      const hasX = cm.some((c) => /^x:/i.test(String(c)));
      const reachable = emailOnly ? hasEmail : hasEmail || hasX;
      if (!reachable) continue;
      out.push({
        ...e,
        score_value: s.value,
        score_reason: s.reason,
      });
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
    const now = new Date().toISOString();
    this.data.missions[id] = {
      id,
      agent_type: agentType,
      target_entity_id: targetEntityId,
      status: "pending",
      payload,
      created_at: now,
      updated_at: now,
    };
    this.scheduleSave();
    return id;
  }

  async listPendingMissions(agentType: string) {
    return Object.values(this.data.missions)
      .filter((m) => m.agent_type === agentType && m.status === "pending")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  async completeMission(id: string): Promise<void> {
    const m = this.data.missions[id];
    if (m) {
      m.status = "completed";
      m.updated_at = new Date().toISOString();
      this.scheduleSave();
    }
  }

  async logOutreach(
    entityId: string,
    channel: string,
    status: string,
    opts?: string | OutreachLogOptions
  ): Promise<string> {
    const options: OutreachLogOptions =
      typeof opts === "string" ? { contentHash: opts } : (opts ?? {});
    const id = uuidv4();
    this.data.outreach_events[id] = {
      id,
      entity_id: entityId,
      channel,
      status,
      content_hash: options.contentHash,
      subject: options.subject,
      body: options.body,
      failure_reason: options.failureReason,
      sent_at: status === "sent" ? new Date().toISOString() : undefined,
      created_at: new Date().toISOString(),
    };
    this.scheduleSave();
    return id;
  }

  async getLatestOutreach(
    entityId: string,
    statuses?: string[]
  ): Promise<OutreachRow | null> {
    const rows = Object.values(this.data.outreach_events)
      .filter((o) => o.entity_id === entityId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (statuses) {
      return rows.find((o) => statuses.includes(o.status)) ?? null;
    }
    return rows[0] ?? null;
  }

  async entitiesWithLatestOutreachStatus(status: string): Promise<string[]> {
    const latest = new Map<string, OutreachRow>();
    for (const row of Object.values(this.data.outreach_events)) {
      const prev = latest.get(row.entity_id);
      if (!prev || row.created_at > prev.created_at) {
        latest.set(row.entity_id, row);
      }
    }
    return [...latest.entries()]
      .filter(([, row]) => row.status === status)
      .map(([entityId]) => entityId);
  }

  async logAudit(
    agent: string,
    eventType: string,
    payload: Record<string, unknown>,
    entityId?: string
  ): Promise<void> {
    this.data.audit_events.push({
      id: uuidv4(),
      entity_id: entityId,
      agent,
      event_type: eventType,
      payload,
      created_at: new Date().toISOString(),
    });
    if (this.data.audit_events.length > 100) {
      this.data.audit_events = this.data.audit_events.slice(-50);
    }
    /* audit is in-memory only during run — no disk churn */
  }

  async getScore(
    entityId: string,
    scoreType: string
  ): Promise<{ value: number; reason?: string; computed_at: Date } | null> {
    const row = this.data.scores[`${entityId}:${scoreType}`];
    if (!row) return null;
    return {
      value: row.value,
      reason: row.reason,
      computed_at: new Date(row.computed_at),
    };
  }

  async listOutreachForEntity(entityId: string, limit = 50) {
    return Object.values(this.data.outreach_events)
      .filter((o) => o.entity_id === entityId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(-limit) as unknown as Array<Record<string, unknown>>;
  }

  async listRecentOutreach(limit = 200) {
    return Object.values(this.data.outreach_events)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit) as unknown as Array<Record<string, unknown>>;
  }

  async clearFarcasterOutreach(): Promise<number> {
    let cleared = 0;
    for (const [id, row] of Object.entries(this.data.outreach_events)) {
      if (row.channel?.startsWith("farcaster_")) {
        delete this.data.outreach_events[id];
        cleared++;
      }
    }
    if (cleared > 0) this.scheduleSave();
    return cleared;
  }

  async clearFarcasterReplyOutreach(): Promise<number> {
    let cleared = 0;
    for (const [id, row] of Object.entries(this.data.outreach_events)) {
      if (row.channel === "farcaster_reply") {
        delete this.data.outreach_events[id];
        cleared++;
      }
    }
    if (cleared > 0) this.scheduleSave();
    return cleared;
  }

  async topByScore(scoreType: string, minValue: number, limit = 50) {
    const rows = Object.values(this.data.scores)
      .filter((s) => s.score_type === scoreType && s.value >= minValue)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
    return rows
      .map((s) => {
        const e = this.data.entities[s.entity_id];
        if (!e) return null;
        return {
          ...e,
          score_value: s.value,
          score_reason: s.reason,
          score_computed_at: s.computed_at,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;
  }

  async listEntitySignals(entityId: string, limit = 30) {
    return this.data.audit_events
      .filter((a) => a.entity_id === entityId && a.event_type === "signal")
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((a) => ({ payload: a.payload, created_at: new Date(a.created_at) }));
  }

  async recordSignal(
    entityId: string,
    agent: string,
    signalType: string,
    strength: number,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    await this.logAudit(agent, "signal", { type: signalType, strength, ...payload }, entityId);
  }

  async upsertNode(
    id: string,
    labels: string[],
    properties: Record<string, unknown>
  ): Promise<void> {
    this.data.nodes[id] = {
      id,
      labels,
      properties: { ...properties, id },
      updated_at: new Date().toISOString(),
    };
    this.scheduleSave();
  }

  async createRelationship(
    fromId: string,
    toId: string,
    type: string,
    properties: Record<string, unknown> = {}
  ): Promise<void> {
    if (this.data.relationships.length >= 3000) return;
    const exists = this.data.relationships.some(
      (r) => r.fromId === fromId && r.toId === toId && r.type === type
    );
    if (exists) return;
    this.data.relationships.push({ fromId, toId, type, properties });
    this.scheduleSave();
  }

  async getEntitySlice(entityId: string): Promise<Record<string, unknown>> {
    const node = this.data.nodes[entityId];
    if (!node) return { id: entityId, neighbors: [] };
    const neighbors = this.data.relationships
      .filter((r) => r.fromId === entityId || r.toId === entityId)
      .map((r) => ({
        rel: r.type,
        node: this.data.nodes[r.fromId === entityId ? r.toId : r.fromId]?.properties,
      }));
    return { ...node.properties, neighbors };
  }

  async countNodes(): Promise<number> {
    return Object.keys(this.data.nodes).length;
  }

  async initCollections(): Promise<void> {
    /* no-op */
  }

  embedText(text: string, dim = 384): number[] {
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dim] += text.charCodeAt(i) / 255;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  }

  async upsertVector(
    collection: string,
    entityId: string,
    text: string,
    payload: Record<string, unknown> = {}
  ): Promise<void> {
    const key = `${collection}:${entityId}`;
    this.data.vectors[key] = {
      collection,
      entityId,
      vector: this.embedText(text),
      payload: { ...payload, entity_id: entityId, text },
    };
    this.scheduleSave();
  }

  async searchVectors(
    collection: string,
    text: string,
    limit = 5
  ): Promise<Array<{ id: string; score: number; payload: Record<string, unknown> }>> {
    const query = this.embedText(text);
    const items = Object.values(this.data.vectors).filter((v) => v.collection === collection);
    const scored = items
      .map((v) => ({
        id: v.entityId,
        score: cosine(query, v.vector),
        payload: v.payload,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return scored;
  }

  async close(): Promise<void> {
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.backupNow();
    this.saveNow();
  }
}

function normalizeData(parsed: LiteData): LiteData {
  return {
    entities: parsed.entities ?? {},
    missions: parsed.missions ?? {},
    outreach_events: parsed.outreach_events ?? {},
    scores: parsed.scores ?? {},
    audit_events: parsed.audit_events ?? [],
    nodes: parsed.nodes ?? {},
    relationships: parsed.relationships ?? [],
    vectors: parsed.vectors ?? {},
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

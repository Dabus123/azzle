/**
 * Serves force_observatory.html + live graph JSON from .azzle-force-lite/
 * Usage: npm run observatory → http://localhost:4021
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const liteDir = resolve(root, ".azzle-force-lite");
const mpsaDir = resolve(root, "config", "mpsa");
const port = Number(process.env.AZZLE_OBSERVATORY_PORT ?? "4021");

const LAYER_TITLES = {
  O: "Ontology (O)",
  P: "Physics (P)",
  C: "Cognition (C)",
  G: "Objective (G)",
  S: "Stability (S)",
};

/** @type {{ shared: object, modes: object[], stacks: object } | null} */
let mpsaCache = null;

function loadMPSAData() {
  if (mpsaCache) return mpsaCache;
  try {
    const shared = JSON.parse(readFileSync(resolve(mpsaDir, "shared-layers.json"), "utf8"));
    const modesFile = JSON.parse(readFileSync(resolve(mpsaDir, "reality-modes.json"), "utf8"));
    const stacksFile = JSON.parse(readFileSync(resolve(mpsaDir, "agent-stacks.json"), "utf8"));
    mpsaCache = { shared, modes: modesFile.modes, stacks: stacksFile };
    return mpsaCache;
  } catch {
    return null;
  }
}

function resolveAgentStack(agentId) {
  const data = loadMPSAData();
  if (!data) return null;
  const override = data.stacks.agents[agentId] ?? {};
  const modeId = override.reality_mode ?? data.stacks.default_reality_mode;
  const mode = data.modes.find((m) => m.id === modeId) ?? data.modes[0];
  if (!mode) return null;
  return {
    agent_id: agentId,
    reality_mode: mode.id,
    reality_name: mode.name,
    reality_description: mode.description,
    task_hint: mode.task_hint ?? null,
    execution_order: data.shared.execution_order ?? ["O", "P", "C", "G", "S"],
    layers: [
      { id: "O", title: LAYER_TITLES.O, content: mode.o_layer, source: `reality:${mode.id}` },
      { id: "P", title: LAYER_TITLES.P, content: mode.p_layer, source: `reality:${mode.id}` },
      {
        id: "C",
        title: LAYER_TITLES.C,
        content: override.c_layer ?? data.shared.default_c_layer,
        source: override.c_layer ? `agent:${agentId}` : "shared",
      },
      {
        id: "G",
        title: LAYER_TITLES.G,
        content: override.g_layer ?? data.shared.default_g_layer,
        source: override.g_layer ? `agent:${agentId}` : "shared",
      },
      { id: "S", title: LAYER_TITLES.S, content: data.shared.shared_s_layer, source: "swarm-shared" },
    ],
  };
}

function buildMPSAApi(agentFilter) {
  const data = loadMPSAData();
  if (!data) return { ok: false, error: "MPSA config not found" };

  let agentIds = Object.keys(data.stacks.agents);
  if (agentFilter) {
    agentIds = agentIds.filter((id) => id === agentFilter);
    if (agentIds.length === 0 && agentFilter) agentIds = [agentFilter];
  }

  return {
    ok: true,
    version: 1,
    execution_order: data.shared.execution_order,
    reality_modes: data.modes.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
    })),
    agents: agentIds.map((id) => resolveAgentStack(id)).filter(Boolean),
    selected: agentFilter ?? null,
  };
}

const MAX_ENTITIES = Number(process.env.AZZLE_OBS_MAX_ENTITIES ?? "2500");
const MAX_EDGES = Number(process.env.AZZLE_OBS_MAX_EDGES ?? "800");
const MAX_OUTREACH = Number(process.env.AZZLE_OBS_MAX_OUTREACH ?? "400");
const MAX_ACTIVITY = Number(process.env.AZZLE_OBS_MAX_ACTIVITY ?? "80");
const PROB_THRESHOLD = Number(process.env.AZZLE_PROBABILITY_THRESHOLD ?? "0.75");

const GRAPH_CANDIDATES = ["graph.snapshot.json", "graph.json", "graph.json.bak"];

function findGraphPath() {
  for (const name of GRAPH_CANDIDATES) {
    const fp = resolve(liteDir, name);
    if (existsSync(fp)) return fp;
  }
  return null;
}

const emptyGraph = {
  meta: {
    total_entities: 0,
    total_edges: 0,
    shown_entities: 0,
    shown_edges: 0,
    rev: 0,
    funnel: null,
    score_types: {},
  },
  entities: {},
  relationships: [],
  scores: {},
  outreach_events: {},
  activity: [],
  hot_prospects: [],
};

/** @type {{ path: string | null, mtime: number, summary: string, rev: number }} */
const cache = { path: null, mtime: 0, summary: "", rev: 0 };

function hasReachableContact(metadata) {
  const cm = metadata?.contact_methods;
  if (!Array.isArray(cm)) return false;
  for (const c of cm) {
    const s = String(c);
    if (/^x:/i.test(s)) return true;
    if (/^email:[^\s@]+@[^\s@]+/i.test(s.trim())) return true;
  }
  return false;
}

function buildScoreMaps(scores) {
  const probability = new Map();
  const heat = new Map();
  const scoreTypes = {};

  for (const s of Object.values(scores)) {
    const id = s.entity_id;
    const v = Number(s.value) || 0;
    scoreTypes[s.score_type] = (scoreTypes[s.score_type] ?? 0) + 1;
    if (s.score_type === "azzle_probability") {
      probability.set(id, Math.max(probability.get(id) ?? 0, v));
    }
    if (s.score_type === "relationship_heat") {
      heat.set(id, Math.max(heat.get(id) ?? 0, v));
    }
  }
  return { probability, heat, scoreTypes };
}

function latestOutreachByEntity(outreach) {
  const latest = new Map();
  for (const o of Object.values(outreach)) {
    const id = o.entity_id;
    const created = o.created_at ?? "";
    const prev = latest.get(id);
    if (!prev || created > prev.created_at) {
      latest.set(id, o);
    }
  }
  return latest;
}

function computeFunnel(entities, scores, outreach, threshold) {
  const { probability } = buildScoreMaps(scores);
  const latest = latestOutreachByEntity(outreach);
  const ids = Object.keys(entities);

  let withOwner = 0;
  let scored = 0;
  let aboveThreshold = 0;
  let withContact = 0;
  let contactableQualified = 0;

  for (const id of ids) {
    const e = entities[id];
    const meta = e.metadata ?? {};
    if (meta.owner || (e.name && e.name.includes("/"))) withOwner++;
    const p = probability.get(id);
    if (p != null) scored++;
    if ((p ?? 0) >= threshold) aboveThreshold++;
    if (hasReachableContact(meta)) withContact++;
    if ((p ?? 0) >= threshold && hasReachableContact(meta)) contactableQualified++;
  }

  const statusCounts = {
    sent: 0,
    draft: 0,
    replied: 0,
    converted: 0,
    send_failed: 0,
    skipped_no_contact: 0,
    skipped_duplicate_contact: 0,
    pending_approval: 0,
    opened: 0,
  };

  for (const o of latest.values()) {
    const st = o.status;
    if (st in statusCounts) statusCounts[st]++;
    else statusCounts[st] = (statusCounts[st] ?? 0) + 1;
  }

  let awaitingOutreach = 0;
  const handled = new Set([
    "sent",
    "replied",
    "converted",
    "send_failed",
    "skipped_no_contact",
    "skipped_duplicate_contact",
    "draft",
    "pending_approval",
  ]);
  for (const id of ids) {
    if ((probability.get(id) ?? 0) < threshold) continue;
    if (!hasReachableContact(entities[id].metadata ?? {})) continue;
    const lo = latest.get(id);
    if (!lo || !handled.has(lo.status)) awaitingOutreach++;
  }

  return {
    total: ids.length,
    with_owner: withOwner,
    scored,
    above_threshold: aboveThreshold,
    with_contact: withContact,
    contactable_qualified: contactableQualified,
    awaiting_outreach: awaitingOutreach,
    outreach_entities: latest.size,
    status: statusCounts,
    threshold,
  };
}

function buildActivity(auditEvents, outreach, limit) {
  const rows = [];

  for (const o of Object.values(outreach)) {
    rows.push({
      at: o.created_at ?? o.sent_at ?? "",
      kind: "outreach",
      status: o.status,
      entity_id: o.entity_id,
      channel: o.channel,
      preview: (o.subject || o.body || "").slice(0, 120),
    });
  }

  for (const a of auditEvents ?? []) {
    if (a.event_type === "signal" || a.event_type === "outcome" || a.event_type === "playbook_evolved") {
      rows.push({
        at: a.created_at ?? "",
        kind: a.event_type,
        agent: a.agent,
        entity_id: a.entity_id,
        preview: JSON.stringify(a.payload ?? {}).slice(0, 100),
      });
    }
  }

  return rows
    .filter((r) => r.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

function buildHotProspects(entities, probability, heat, latestOutreach, limit = 15) {
  const rows = [];
  for (const [id, h] of heat) {
    const e = entities[id];
    if (!e) continue;
    const lo = latestOutreach.get(id);
    rows.push({
      id,
      name: e.name,
      type: e.type,
      heat: h,
      probability: probability.get(id) ?? 0,
      outreach_status: lo?.status ?? null,
    });
  }
  return rows.sort((a, b) => b.heat - a.heat).slice(0, limit);
}

function summarizeGraph(data, rev) {
  const entities = data.entities ?? {};
  const scores = data.scores ?? {};
  const rels = data.relationships ?? [];
  const outreach = data.outreach_events ?? {};
  const audit = data.audit_events ?? [];
  const allIds = Object.keys(entities);

  const { probability, heat, scoreTypes } = buildScoreMaps(scores);
  const latestOutreach = latestOutreachByEntity(outreach);

  const ranked = allIds.sort((a, b) => {
    const dh = (heat.get(b) ?? 0) - (heat.get(a) ?? 0);
    if (dh !== 0) return dh;
    const ds = (probability.get(b) ?? 0) - (probability.get(a) ?? 0);
    if (ds !== 0) return ds;
    return (entities[b]?.updated_at ?? "").localeCompare(entities[a]?.updated_at ?? "");
  });

  const visible = ranked.slice(0, MAX_ENTITIES);
  const visibleSet = new Set(visible);

  const pickedEntities = {};
  for (const id of visible) {
    const e = entities[id];
    const meta = e.metadata ?? {};
    const lo = latestOutreach.get(id);
    const dist = meta.distribution;
    pickedEntities[id] = {
      id: e.id,
      type: e.type,
      name: e.name,
      updated_at: e.updated_at,
      probability: probability.get(id) ?? 0,
      heat: heat.get(id) ?? 0,
      has_contact: hasReachableContact(meta),
      outreach_status: lo?.status ?? null,
      outreach_channel: lo?.channel ?? null,
      proximity: dist?.proximity ?? null,
      preferred_channel: dist?.preferred_channel ?? null,
    };
  }

  const pickedScores = {};
  for (const [k, s] of Object.entries(scores)) {
    if (!visibleSet.has(s.entity_id)) continue;
    pickedScores[k] = {
      entity_id: s.entity_id,
      score_type: s.score_type,
      value: s.value,
      reason: s.reason,
      computed_at: s.computed_at,
    };
  }

  const pickedRels = [];
  for (const r of rels) {
    if (pickedRels.length >= MAX_EDGES) break;
    if (visibleSet.has(r.fromId) && visibleSet.has(r.toId)) pickedRels.push(r);
  }

  const outreachSorted = Object.entries(outreach).sort(([, a], [, b]) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
  );
  const outreachSlice = outreachSorted.slice(-MAX_OUTREACH);
  const pickedOutreach = Object.fromEntries(outreachSlice);

  const funnel = computeFunnel(entities, scores, outreach, PROB_THRESHOLD);
  const activity = buildActivity(audit, outreach, MAX_ACTIVITY);
  const hot_prospects = buildHotProspects(entities, probability, heat, latestOutreach);

  return {
    meta: {
      total_entities: allIds.length,
      total_edges: rels.length,
      total_outreach_events: Object.keys(outreach).length,
      total_scores: Object.keys(scores).length,
      shown_entities: visible.length,
      shown_edges: pickedRels.length,
      truncated: allIds.length > MAX_ENTITIES,
      rev,
      funnel,
      score_types: scoreTypes,
      hot_count: hot_prospects.filter((h) => h.heat >= 0.55).length,
      replied_count: funnel.status.replied ?? 0,
    },
    entities: pickedEntities,
    relationships: pickedRels,
    scores: pickedScores,
    outreach_events: pickedOutreach,
    activity,
    hot_prospects,
  };
}

function loadGraphSummary() {
  const fp = findGraphPath();
  if (!fp) return JSON.stringify(emptyGraph);

  const mtime = statSync(fp).mtimeMs;
  if (cache.path === fp && cache.mtime === mtime && cache.summary) {
    return cache.summary;
  }

  let data;
  try {
    data = JSON.parse(readFileSync(fp, "utf8"));
  } catch {
    return JSON.stringify(emptyGraph);
  }

  const summary = summarizeGraph(data, mtime);
  cache.path = fp;
  cache.mtime = mtime;
  cache.rev = mtime;
  cache.summary = JSON.stringify(summary);
  return cache.summary;
}

function serveBinary(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return false;
  }
  const buf = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
    "Cache-Control": "public, max-age=300",
  });
  res.end(buf);
  return true;
}

function serveFile(res, filePath, contentType) {
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const buf = readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": buf.length,
  });
  res.end(buf);
}

const LOGO_CANDIDATES = [
  resolve(root, "..", "docs", "azzleSTL.stl"),
  resolve(root, "assets", "azzleSTL.stl"),
];

const LOGO_VOXEL_CACHE = resolve(root, "assets", "logo-voxels.json");

/** @type {number[][] | null} */
let logoVoxelsCache = null;

function voxelizeStl(buf) {
  const triCount = buf.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const centroids = [];

  let off = 84;
  for (let i = 0; i < triCount; i++) {
    off += 12;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let v = 0; v < 3; v++) {
      const x = buf.readFloatLE(off);
      const y = buf.readFloatLE(off + 4);
      const z = buf.readFloatLE(off + 8);
      off += 12;
      min[0] = Math.min(min[0], x);
      max[0] = Math.max(max[0], x);
      min[1] = Math.min(min[1], y);
      max[1] = Math.max(max[1], y);
      min[2] = Math.min(min[2], z);
      max[2] = Math.max(max[2], z);
      cx += x;
      cy += y;
      cz += z;
    }
    off += 2;
    if (i % 8 !== 0) continue;
    centroids.push([cx / 3, cy / 3, cz / 3]);
  }

  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const cx0 = (min[0] + max[0]) / 2;
  const cy0 = (min[1] + max[1]) / 2;
  const cz0 = (min[2] + max[2]) / 2;
  const scale = 6.5 / Math.max(sx, sy, sz);
  const RES = 52;
  const seen = new Set();
  const pts = [];

  for (const [cx, cy, cz] of centroids) {
    const ix = Math.min(RES - 1, Math.max(0, Math.floor(((cx - min[0]) / sx) * (RES - 1))));
    const iy = Math.min(RES - 1, Math.max(0, Math.floor(((cy - min[1]) / sy) * (RES - 1))));
    const iz = Math.min(RES - 1, Math.max(0, Math.floor(((cz - min[2]) / sz) * (RES - 1))));
    const key = `${ix},${iy},${iz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = ((ix / (RES - 1)) * sx + min[0] - cx0) * scale;
    const y = ((iy / (RES - 1)) * sy + min[1] - cy0) * scale;
    const z = ((iz / (RES - 1)) * sz + min[2] - cz0) * scale;
    pts.push([
      Math.round(x * 100) / 100,
      Math.round(y * 100) / 100,
      Math.round(z * 100) / 100,
    ]);
  }
  return pts;
}

function loadLogoVoxels() {
  if (logoVoxelsCache) return logoVoxelsCache;

  for (const fp of LOGO_CANDIDATES) {
    if (!existsSync(fp)) continue;
    try {
      const buf = readFileSync(fp);
      if (buf.length < 84) continue;
      const header = buf.slice(0, 5).toString("ascii");
      if (header === "solid") continue;
      logoVoxelsCache = voxelizeStl(buf);
      console.log(`[observatory] logo mesh: ${logoVoxelsCache.length} voxels from ${fp}`);
      return logoVoxelsCache;
    } catch (err) {
      console.warn(`[observatory] logo STL skip ${fp}:`, err);
    }
  }

  if (existsSync(LOGO_VOXEL_CACHE)) {
    try {
      logoVoxelsCache = JSON.parse(readFileSync(LOGO_VOXEL_CACHE, "utf8"));
      return logoVoxelsCache;
    } catch {
      /* fall through */
    }
  }

  logoVoxelsCache = [];
  return logoVoxelsCache;
}

const LOGO_PNG_CANDIDATES = [
  resolve(root, "assets", "azzlelogo.png"),
  resolve(root, "azzlelogo.png"),
  resolve(root, "..", "launch-skills", "azzlelogo.png"),
];

function serveLogo(res) {
  for (const fp of LOGO_PNG_CANDIDATES) {
    if (serveBinary(res, fp, "image/png")) return;
  }
  res.writeHead(404);
  res.end("Not found");
}

const server = createServer((req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (url === "/api/graph") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(loadGraphSummary());
    return;
  }

  if (url === "/api/logo") {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    });
    res.end(JSON.stringify(loadLogoVoxels()));
    return;
  }

  if (url === "/api/mpsa" || url.startsWith("/api/mpsa?")) {
    const q = new URL(req.url, "http://localhost").searchParams;
    const agent = q.get("agent") ?? undefined;
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(buildMPSAApi(agent)));
    return;
  }

  if (url === "/" || url === "/observatory") {
    serveFile(res, resolve(root, "force_observatory.html"), "text/html; charset=utf-8");
    return;
  }

  if (url === "/config/waves.json") {
    serveFile(res, resolve(root, "config", "default.json"), "application/json");
    return;
  }

  if (url === "/azzlelogo.png" || url === "/assets/azzlelogo.png") {
    serveLogo(res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[observatory] Port ${port} already in use.\n` +
        `  Open http://localhost:${port}\n` +
        `  Or: AZZLE_OBSERVATORY_PORT=4022 npm run observatory`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  loadLogoVoxels();
  console.log(`[observatory] AZZLE FORCE map → http://localhost:${port}`);
  console.log(`[observatory] Graph dir: ${liteDir}`);
  console.log(
    `[observatory] Caps: ${MAX_ENTITIES} entities · ${MAX_EDGES} edges · ${MAX_OUTREACH} outreach · funnel+heat · MPSA stack`
  );
});

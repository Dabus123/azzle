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
const port = Number(process.env.AZZLE_OBSERVATORY_PORT ?? "4021");

const MAX_ENTITIES = Number(process.env.AZZLE_OBS_MAX_ENTITIES ?? "2500");
const MAX_EDGES = Number(process.env.AZZLE_OBS_MAX_EDGES ?? "500");

const GRAPH_CANDIDATES = [
  "graph.snapshot.json",
  "graph.json",
  "graph.json.bak",
];

function findGraphPath() {
  for (const name of GRAPH_CANDIDATES) {
    const fp = resolve(liteDir, name);
    if (existsSync(fp)) return fp;
  }
  return null;
}

const emptyGraph = {
  meta: { total_entities: 0, total_edges: 0, shown_entities: 0, shown_edges: 0, rev: 0 },
  entities: {},
  nodes: {},
  relationships: [],
  scores: {},
  outreach_events: {},
};

/** @type {{ path: string | null, mtime: number, summary: string, rev: number }} */
const cache = { path: null, mtime: 0, summary: "", rev: 0 };

function summarizeGraph(data, rev) {
  const entities = data.entities ?? {};
  const scores = data.scores ?? {};
  const rels = data.relationships ?? [];
  const allIds = Object.keys(entities);

  const scoreByEntity = new Map();
  for (const s of Object.values(scores)) {
    if (s.score_type !== "azzle_probability") continue;
    const id = s.entity_id;
    const v = Number(s.value) || 0;
    const cur = scoreByEntity.get(id) ?? 0;
    if (v > cur) scoreByEntity.set(id, v);
  }

  const ranked = allIds.sort((a, b) => {
    const ds = (scoreByEntity.get(b) ?? 0) - (scoreByEntity.get(a) ?? 0);
    if (ds !== 0) return ds;
    return (entities[b]?.updated_at ?? "").localeCompare(entities[a]?.updated_at ?? "");
  });

  const visible = ranked.slice(0, MAX_ENTITIES);
  const visibleSet = new Set(visible);

  const pickedEntities = {};
  for (const id of visible) {
    const e = entities[id];
    pickedEntities[id] = {
      id: e.id,
      type: e.type,
      name: e.name,
      updated_at: e.updated_at,
    };
  }

  const pickedScores = {};
  for (const [k, s] of Object.entries(scores)) {
    if (s.score_type !== "azzle_probability") continue;
    if (visibleSet.has(s.entity_id)) pickedScores[k] = { entity_id: s.entity_id, score_type: s.score_type, value: s.value };
  }

  const pickedRels = [];
  for (const r of rels) {
    if (pickedRels.length >= MAX_EDGES) break;
    if (visibleSet.has(r.fromId) && visibleSet.has(r.toId)) pickedRels.push(r);
  }

  const outreach = data.outreach_events ?? {};
  const outreachKeys = Object.keys(outreach).slice(-80);
  const pickedOutreach = {};
  for (const k of outreachKeys) pickedOutreach[k] = outreach[k];

  return {
    meta: {
      total_entities: allIds.length,
      total_edges: rels.length,
      shown_entities: visible.length,
      shown_edges: pickedRels.length,
      truncated: allIds.length > MAX_ENTITIES,
      rev,
    },
    entities: pickedEntities,
    nodes: {},
    relationships: pickedRels,
    scores: pickedScores,
    outreach_events: pickedOutreach,
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

/** Binary STL → centered voxel cloud for observatory center logo. */
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
    const ix = Math.min(
      RES - 1,
      Math.max(0, Math.floor(((cx - min[0]) / sx) * (RES - 1)))
    );
    const iy = Math.min(
      RES - 1,
      Math.max(0, Math.floor(((cy - min[1]) / sy) * (RES - 1)))
    );
    const iz = Math.min(
      RES - 1,
      Math.max(0, Math.floor(((cz - min[2]) / sz) * (RES - 1)))
    );
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
      console.log(`[observatory] logo mesh: ${logoVoxelsCache.length} voxels (cached json)`);
      return logoVoxelsCache;
    } catch {
      /* fall through */
    }
  }

  logoVoxelsCache = [];
  console.warn("[observatory] logo mesh not found — place docs/azzleSTL.stl in repo");
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
        `  Open http://localhost:${port} (server may already be running)\n` +
        `  Or: AZZLE_OBSERVATORY_PORT=4022 npm run observatory\n` +
        `  Windows: netstat -ano | findstr :${port}  then  taskkill /PID <pid> /F`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, () => {
  loadLogoVoxels();
  console.log(`[observatory] AZZLE FORCE map → http://localhost:${port}`);
  console.log(`[observatory] Graph dir: ${liteDir}`);
  console.log(`[observatory] View cap: ${MAX_ENTITIES} entities · ${MAX_EDGES} edges`);
  console.log(`[observatory] Run npm run lite in another terminal to watch live`);
});

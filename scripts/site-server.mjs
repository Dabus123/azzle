/**
 * AZZLE.org local site + role-dashboard LLM proxy (Bankr Gateway).
 *
 *   node --env-file=azzle-force/.env scripts/site-server.mjs
 *   # or: npm start
 *
 * Production: deploy to Vercel (see vercel.json). APIs live in api/handler.js.
 */
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { handleSiteApi, loadEnvFile, sendApiResult } from "./site-api.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = normalize(join(__dirname, ".."));

loadEnvFile(resolve(ROOT, "azzle-force", ".env"));
const PORT = Number(process.env.AZZLE_SITE_PORT ?? "8080");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(pathname, res) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  if (rel === "/post" || rel === "/post/") rel = "/post.html";
  if (rel === "/pricing" || rel === "/pricing/") rel = "/pricing.html";
  if (rel === "/my-tasks" || rel === "/my-tasks/") rel = "/my-tasks.html";
  if (rel === "/wallet" || rel === "/wallet/") rel = "/wallet.html";
  const filePath = normalize(join(ROOT, rel.replace(/^\//, "")));
  if (!filePath.startsWith(ROOT) || !existsSync(filePath)) return false;
  const ext = filePath.includes(".") ? filePath.slice(filePath.lastIndexOf(".")) : "";
  const body = await readFile(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  res.end(body);
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (path.startsWith("/api/")) {
      let body = {};
      if (req.method === "POST") {
        try {
          body = await readBody(req);
        } catch {
          sendApiResult(res, {
            status: 400,
            headers: { "Content-Type": "application/json" },
            json: { error: "Invalid JSON body" },
          });
          return;
        }
      }
      const result = await handleSiteApi({
        method: req.method ?? "GET",
        pathname: path,
        searchParams: url.searchParams,
        body,
      });
      sendApiResult(res, result);
      return;
    }

    if ((req.method === "GET" || req.method === "HEAD") && (await serveStatic(path, res))) {
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message ?? String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[azzle-site] http://localhost:${PORT}`);
  console.log(`[azzle-site] LLM     POST /api/role-chat`);
  if (!process.env.BANKR_API_KEY) console.warn("[azzle-site] WARN: BANKR_API_KEY unset — chat will return 503");
  if (!process.env.PRIVY_APP_ID) console.warn("[azzle-site] WARN: PRIVY_APP_ID unset — wallet connect disabled");
});

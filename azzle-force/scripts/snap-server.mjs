#!/usr/bin/env node
/**
 * Viral AZZLE Snap — local dev server (production: https://azzle.org/snap on Vercel).
 * Serves snap JSON via Accept: application/vnd.farcaster.snap+json
 * Run: npm run snap-server
 * Env: AZZLE_SNAP_PORT=4026, AZZLE_MINIAPP_URL, AZZLE_SNAP_PUBLIC_URL
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapPayload } from "../../api/lib/snap-payload.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AZZLE_SNAP_PORT ?? "4026");

/** @type {{ human: number; agent: number; voters: Set<number> }} */
const state = { human: 0, agent: 0, voters: new Set() };

function snapUrl() {
  return process.env.AZZLE_SNAP_PUBLIC_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;
}

function buildSnap(fid) {
  return buildSnapPayload(
    { human: state.human, agent: state.agent, voters: [...state.voters] },
    { fid: fid ?? null, snapUrl: snapUrl() }
  );
}

function parsePostBody(buf) {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return {};
  }
}

function extractFid(body) {
  const fid = body?.user?.fid ?? body?.authenticatedUser?.fid ?? body?.fid;
  return fid != null ? Number(fid) : null;
}

const fallbackHtml = readFileSync(resolve(__dir, "../miniapps/human-terminal/index.html"), "utf8");

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const accept = req.headers.accept || "";
  const wantsSnap = accept.includes("application/vnd.farcaster.snap+json");
  const action = url.searchParams.get("action");

  if (req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = parsePostBody(Buffer.concat(chunks));
    const fid = extractFid(body);

    if (action === "human" || action === "agent") {
      if (fid != null && !state.voters.has(fid)) {
        state.voters.add(fid);
        if (action === "human") state.human++;
        else state.agent++;
      } else if (fid == null) {
        if (action === "human") state.human++;
        else state.agent++;
      }
    }

    const snap = buildSnap(fid ?? undefined);
    res.writeHead(200, {
      "Content-Type": "application/vnd.farcaster.snap+json",
      Vary: "Accept",
    });
    res.end(JSON.stringify(snap));
    return;
  }

  if (wantsSnap) {
    const snap = buildSnap();
    res.writeHead(200, {
      "Content-Type": "application/vnd.farcaster.snap+json",
      Vary: "Accept",
    });
    res.end(JSON.stringify(snap));
    return;
  }

  if (url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, votes: { human: state.human, agent: state.agent } }));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(fallbackHtml);
});

server.listen(PORT, () => {
  console.log(`[snap] Human Terminal snap on http://localhost:${PORT}`);
  console.log(`[snap] Test: curl -H "Accept: application/vnd.farcaster.snap+json" http://localhost:${PORT}/`);
});

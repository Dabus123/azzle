/**
 * Farcaster Snap — Human Terminal poll at https://www.azzle.org/snap
 * Content negotiation: Accept: application/vnd.farcaster.snap+json
 */
import { readJsonBody, requestUrl } from "../lib/vercel-http.js";
import { getVoteState, recordVote } from "../lib/snap-state.js";
import { buildSnapPayload, snapFallbackHtml } from "../lib/snap-payload.js";
import {
  SNAP_ACCEPT,
  SNAP_CORS,
  resolveSnapBase,
  snapHtmlHeaders,
  snapJsonHeaders,
} from "../lib/snap-http.js";

function extractFid(body) {
  const fid = body?.user?.fid ?? body?.authenticatedUser?.fid ?? body?.fid;
  return fid != null ? Number(fid) : null;
}

function sendSnap(res, payload, snapUrl) {
  res.writeHead(200, snapJsonHeaders(snapUrl));
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  const url = requestUrl(req, "/snap");
  const snapUrl = resolveSnapBase(req);
  const accept = String(req.headers.accept || "");
  const wantsSnap = accept.includes(SNAP_ACCEPT);
  const action = url.searchParams.get("action");
  const snapId = url.searchParams.get("i") || url.searchParams.get("id") || "global";
  const variant = url.searchParams.get("v") || url.searchParams.get("variant") || null;

  if (req.method === "OPTIONS") {
    res.writeHead(204, SNAP_CORS);
    res.end();
    return;
  }

  if (url.searchParams.get("health") === "1" || url.pathname.endsWith("/health")) {
    const state = await getVoteState(snapId);
    res.writeHead(200, { ...SNAP_CORS, "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        snapUrl,
        snapId,
        votes: { human: state.human, agent: state.agent },
      })
    );
    return;
  }

  if (req.method === "POST") {
    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      body = {};
    }
    const fid = extractFid(body);

    if (action === "human" || action === "agent") {
      await recordVote(action, fid, snapId);
    }

    const state = await getVoteState(snapId);
    sendSnap(res, buildSnapPayload(state, { fid, snapUrl, snapId, variant }), snapUrl);
    return;
  }

  if (req.method !== "GET") {
    res.writeHead(405, { ...SNAP_CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }

  if (wantsSnap) {
    const state = await getVoteState(snapId);
    sendSnap(res, buildSnapPayload(state, { snapUrl, snapId, variant }), snapUrl);
    return;
  }

  res.writeHead(200, snapHtmlHeaders(snapUrl));
  res.end(snapFallbackHtml(snapUrl, { snapId, variant }));
}

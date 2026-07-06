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

const __dir = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.AZZLE_SNAP_PORT ?? "4026");
const MINIAPP_URL =
  process.env.AZZLE_MINIAPP_URL?.trim() ||
  process.env.GITHUB_PAGES_MINIAPP_URL?.trim() ||
  "https://azzleforce.github.io/azzleforce/";
const SITE = process.env.OUTREACH_SITE_URL?.trim() || "https://azzle.org";
const LOGO_URL = (process.env.AZZLE_LOGO_URL?.trim() || `${SITE.replace(/\/$/, "")}/azzlelogo.png`);

/** @type {{ human: number; agent: number; voters: Set<number> }} */
const state = { human: 0, agent: 0, voters: new Set() };

function total() {
  return state.human + state.agent || 1;
}

function snapPage(opts) {
  const { title, body, humanPct, agentPct, fid } = opts;
  const voted = fid != null && state.voters.has(fid);
  const snapBase = process.env.AZZLE_SNAP_PUBLIC_URL?.replace(/\/$/, "") || `http://localhost:${PORT}`;

  return {
    version: "2.0",
    theme: { accent: "yellow" },
    effects: voted ? [{ type: "confetti" }] : undefined,
    ui: {
      root: "page",
      elements: {
        page: { type: "stack", props: { gap: 12 }, children: ["logo", "title", "body", "bar", "counts", "row", "mini", "share"] },
        logo: { type: "image", props: { url: LOGO_URL, aspect: "4:1", alt: "AZZLE" } },
        title: { type: "text", props: { content: title, weight: "bold", size: "lg", align: "center" } },
        body: { type: "text", props: { content: body, size: "sm", color: "muted" } },
        bar: {
          type: "progress",
          props: {
            value: agentPct,
            label: `Agentic ${agentPct}% · Prompting ${humanPct}%`,
          },
        },
        counts: {
          type: "text",
          props: {
            content: `${state.agent} agentic · ${state.human} still prompting`,
            size: "xs",
            color: "muted",
          },
        },
        row: {
          type: "row",
          props: { gap: 8 },
          children: voted ? ["thanks"] : ["vote-human", "vote-agent"],
        },
        thanks: {
          type: "text",
          props: { content: "Vote recorded. Share your mode →", size: "sm", color: "accent" },
        },
        "vote-human": {
          type: "button",
          props: { label: "Still prompting", variant: "secondary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${snapBase}/?action=human` },
            },
          },
        },
        "vote-agent": {
          type: "button",
          props: { label: "Went agentic", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${snapBase}/?action=agent` },
            },
          },
        },
        mini: {
          type: "button",
          props: { label: "Open Human Terminal", variant: "secondary" },
          on: {
            press: {
              action: "open_mini_app",
              params: { target: MINIAPP_URL },
            },
          },
        },
        share: {
          type: "button",
          props: { label: "Share → cast", variant: "primary" },
          on: {
            press: {
              action: "compose_cast",
              params: {
                text: `Human Terminal: agents post, claim, prove, and get paid on Base. $5 USDC + 1,000 $AZL. ${MINIAPP_URL}`,
                embeds: [MINIAPP_URL],
              },
            },
          },
        },
      },
    },
  };
}

function buildSnap(fid) {
  const humanPct = Math.round((state.human / total()) * 100);
  const agentPct = 100 - humanPct;
  return snapPage({
    title: "Escape Prompting Hell?",
    body: "AZZLE Labor Organism on Base — USDC escrow, onchain reputation. Vote your mode, then open the Human Terminal mini app.",
    humanPct,
    agentPct,
    fid,
  });
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
  console.log(`[snap] Mini app URL: ${MINIAPP_URL}`);
});

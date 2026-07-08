const SNAP_BASE = (
  process.env.AZZLE_SNAP_PUBLIC_URL ||
  process.env.AZZLE_SNAP_URL ||
  "https://www.azzle.org/snap"
).replace(/\/$/, "");

const MINIAPP_URL = (
  process.env.AZZLE_MINIAPP_URL ||
  process.env.GITHUB_PAGES_MINIAPP_URL ||
  "https://azzleforce.github.io/azzleforce/"
).replace(/\/?$/, "/");

const SITE_URL = (process.env.OUTREACH_SITE_URL || "https://www.azzle.org").replace(/\/$/, "");
const OG_IMAGE = `${SITE_URL}/og.png`;

function miniappEmbedJson(snapUrl) {
  return JSON.stringify({
    version: "1",
    imageUrl: OG_IMAGE,
    button: {
      title: "Open Snap",
      action: {
        type: "launch_miniapp",
        name: "Human Terminal",
        url: snapUrl,
        splashImageUrl: `${SITE_URL}/favicon.ico`,
        splashBackgroundColor: "#0a0a0f",
      },
    },
  });
}

function frameEmbedJson(snapUrl) {
  return JSON.stringify({
    version: "next",
    imageUrl: OG_IMAGE,
    button: {
      title: "Vote & Play",
      action: {
        type: "launch_miniapp",
        name: "Human Terminal",
        url: snapUrl,
        splashImageUrl: `${SITE_URL}/favicon.ico`,
        splashBackgroundColor: "#0a0a0f",
      },
    },
  });
}

function total(state) {
  return state.human + state.agent || 1;
}

/**
 * @param {{ human: number; agent: number; voters: number[] }} state
 * @param {{ fid?: number|null; snapUrl?: string }} opts
 */
export function buildSnapPayload(state, opts = {}) {
  const { fid = null, snapUrl = SNAP_BASE } = opts;
  const snapBase = snapUrl.replace(/\/$/, "");
  const humanPct = Math.round((state.human / total(state)) * 100);
  const agentPct = 100 - humanPct;
  const voted = fid != null && state.voters.includes(fid);

  return {
    version: "2.0",
    theme: { accent: "amber" },
    ...(voted ? { effects: ["confetti"] } : {}),
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: { gap: "md" },
          children: ["title", "body", "bar", "actions", "mini", "share"],
        },
        title: {
          type: "text",
          props: { content: "Escape Prompting Hell?", weight: "bold", align: "center" },
        },
        body: {
          type: "text",
          props: {
            content:
              "AZZLE on Base — USDC escrow task markets. Vote: still prompting or went agentic?",
            size: "sm",
          },
        },
        bar: {
          type: "progress",
          props: {
            value: agentPct,
            max: 100,
            label: `Agentic ${agentPct}% · ${state.agent}v / ${state.human} prompting`,
          },
        },
        actions: {
          type: "stack",
          props: { direction: "horizontal", gap: "sm" },
          children: voted ? ["thanks"] : ["vote-human", "vote-agent"],
        },
        thanks: {
          type: "text",
          props: { content: "Vote recorded — share your mode", size: "sm", align: "center" },
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
          props: { label: "Share cast", variant: "primary" },
          on: {
            press: {
              action: "compose_cast",
              params: {
                text: `Human Terminal: agents post, claim, prove, and get paid on Base. ${MINIAPP_URL}`,
                embeds: [snapBase, MINIAPP_URL],
              },
            },
          },
        },
      },
    },
  };
}

export function snapFallbackHtml(snapUrl = SNAP_BASE) {
  const snap = snapUrl.replace(/\/$/, "");
  const miniapp = miniappEmbedJson(snap);
  const frame = frameEmbedJson(snap);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AZZLE Snap — Human Terminal</title>
<meta name="description" content="Interactive poll: still prompting or went agentic? Vote, see live results, open Human Terminal on Base."/>
<meta property="og:title" content="AZZLE Snap — Human Terminal"/>
<meta property="og:description" content="Vote your mode. Live poll + Human Terminal mini app on Base."/>
<meta property="og:image" content="${OG_IMAGE}"/>
<meta property="og:url" content="${snap}"/>
<link rel="alternate" type="application/vnd.farcaster.snap+json" href="${snap}"/>
<meta name="fc:miniapp" content='${miniapp}'/>
<meta name="fc:frame" content='${frame}'/>
<link rel="canonical" href="${snap}"/>
</head>
<body>
<p>AZZLE Human Terminal Snap — <a href="${snap}">open interactive poll</a> · <a href="${MINIAPP_URL}">mini app</a></p>
</body>
</html>`;
}

export { SNAP_BASE, MINIAPP_URL, SITE_URL };

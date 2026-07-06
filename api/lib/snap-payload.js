const SNAP_BASE = (
  process.env.AZZLE_SNAP_PUBLIC_URL ||
  process.env.AZZLE_SNAP_URL ||
  "https://azzle.org/snap"
).replace(/\/$/, "");

const MINIAPP_URL = (
  process.env.AZZLE_MINIAPP_URL ||
  process.env.GITHUB_PAGES_MINIAPP_URL ||
  "https://azzleforce.github.io/azzleforce/"
).replace(/\/?$/, "/");

const SITE_URL = (process.env.OUTREACH_SITE_URL || "https://azzle.org").replace(/\/$/, "");

const LOGO_URL = (
  process.env.AZZLE_LOGO_URL ||
  `${SITE_URL}/azzlelogo.png`
).replace(/\/$/, "");

function logoElement() {
  return {
    type: "image",
    props: {
      url: LOGO_URL,
      aspect: "4:1",
      alt: "AZZLE",
    },
  };
}

function total(state) {
  return state.human + state.agent || 1;
}

/**
 * @param {{ human: number; agent: number; voters: number[] }} state
 * @param {{ fid?: number|null }} opts
 */
export function buildSnapPayload(state, opts = {}) {
  const { fid = null } = opts;
  const humanPct = Math.round((state.human / total(state)) * 100);
  const agentPct = 100 - humanPct;
  const voted = fid != null && state.voters.includes(fid);

  return {
    version: "2.0",
    theme: { accent: "yellow" },
    effects: voted ? [{ type: "confetti" }] : undefined,
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack",
          props: { gap: 12 },
          children: ["logo", "title", "body", "bar", "counts", "row", "mini", "share"],
        },
        logo: logoElement(),
        title: {
          type: "text",
          props: { content: "Escape Prompting Hell?", weight: "bold", size: "lg", align: "center" },
        },
        body: {
          type: "text",
          props: {
            content:
              "AZZLE Labor Organism on Base — USDC escrow, onchain reputation, $AZL access fees. Vote your mode, then open the Human Terminal.",
            size: "sm",
            color: "muted",
          },
        },
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
              params: { target: `${SNAP_BASE}/?action=human` },
            },
          },
        },
        "vote-agent": {
          type: "button",
          props: { label: "Went agentic", variant: "primary" },
          on: {
            press: {
              action: "submit",
              params: { target: `${SNAP_BASE}/?action=agent` },
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
                embeds: [SNAP_BASE, MINIAPP_URL],
              },
            },
          },
        },
      },
    },
  };
}

export function snapFallbackHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>AZZLE Snap — Human Terminal</title>
<meta http-equiv="refresh" content="0;url=${SITE_URL}"/>
<link rel="canonical" href="${SNAP_BASE}"/>
</head>
<body>
<p>AZZLE Human Terminal Snap — <a href="${SITE_URL}">azzle.org</a> · <a href="${MINIAPP_URL}">mini app</a></p>
</body>
</html>`;
}

export { SNAP_BASE, MINIAPP_URL, SITE_URL, LOGO_URL };

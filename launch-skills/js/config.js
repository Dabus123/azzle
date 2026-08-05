import { MANIFEST, AZL_TOKEN } from "./manifest.generated.js";

export const DEFAULT_GATEWAY = "http://localhost:4020";
export const RPC_URL = "https://mainnet.base.org";
export const CHAIN_ID = 8453;

export const ACCESS_FEE_USDC = 5;
export const ACCESS_FEE_AZL = 1000;

/** Bankr x402 Cloud — paid AZZLE read-data endpoints. @see docs/X402_CLOUD.md */
export const X402_CLOUD_BASE = "https://x402.bankr.bot";

/** Paid endpoints deployed from agents/x402-cloud/ (URL: <base>/<wallet>/<name>). */
export const X402_CLOUD_ENDPOINTS = [
  {
    name: "azzle-open-tasks",
    price: "100 AZL",
    desc: "POSTED tasks (claimable market)",
    example: "?limit=20",
  },
  {
    name: "azzle-task",
    price: "100 AZL",
    desc: "Single task by id",
    example: "?id=1",
  },
  {
    name: "azzle-reputation",
    price: "200 AZL",
    desc: "Agent reputation, history, signals",
    example: "?address=0x0000000000000000000000000000000000000000",
  },
  {
    name: "azzle-leaderboard",
    price: "200 AZL",
    desc: "Top agents by rep / verifiers by bond",
    example: "?kind=reputation&limit=10",
  },
];

/** True when opened as file:// — browsers require the local gateway. */
export function isFileProtocol() {
  return typeof location !== "undefined" && location.protocol === "file:";
}

/**
 * Gateway base URL for API reads.
 * - file:// → must use gateway (http://localhost:4020)
 * - served from gateway (:4020) → same-origin ""
 * - override via ?gateway=http://host:port
 */
export function resolveGatewayBase() {
  if (typeof location === "undefined") return DEFAULT_GATEWAY;
  const q = new URLSearchParams(location.search).get("gateway");
  if (q) return q.replace(/\/$/, "");
  if (location.protocol === "file:") return DEFAULT_GATEWAY;
  if (location.hostname === "localhost" && location.port === "4020") return "";
  return null;
}

function gatewayUrl(path) {
  const base = resolveGatewayBase();
  if (base === null) return null;
  return base ? `${base}${path}` : path;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return json;
}

/** Deprecated GraphQL compatibility hook; active surfaces use Base RPC. */
export async function gql(query, variables = {}) {
  const payload = JSON.stringify({ query, variables });
  const proxy = gatewayUrl("/v1/graphql");

  if (proxy !== null) {
    try {
      const json = await fetchJson(proxy, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (json.errors?.length) {
        throw new Error(json.errors.map((e) => e.message).join("; "));
      }
      if (!json.data) throw new Error("empty V2 response");
      return json.data;
    } catch (e) {
      if (isFileProtocol()) {
        throw new Error(
          `Cannot reach gateway at ${DEFAULT_GATEWAY}. ` +
            `Run: cd agents && npm run gateway — then open ${DEFAULT_GATEWAY}/market.html ` +
            `(do not use file://). Original: ${e.message}`
        );
      }
      throw e;
    }
  }

  // GraphQL is retired; use the V2 RPC endpoints below.
  throw new Error("GraphQL discovery is unavailable; use canonical V2 Base RPC endpoints.");
  /*
  try {
    const res = await fetch(`${DEFAULT_GATEWAY}/v1/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }
    return json.data;
  } catch (directErr) {
    try {
      const json = await fetchJson(`${DEFAULT_GATEWAY}/v1/graphql`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      if (json.errors?.length) {
        throw new Error(json.errors.map((e) => e.message).join("; "));
      }
      return json.data;
    } catch {
      throw directErr;
    }
  }*/
}

/** REST shortcut — POSTED tasks (preferred for market page). */
export async function fetchOpenTasks() {
  const url = gatewayUrl("/v1/market/open");
  if (url !== null) {
    const json = await fetchJson(url);
    return json.tasks ?? [];
  }
  throw new Error("V2 market endpoint unavailable");
}

/** REST shortcut — recent tasks. */
export async function fetchRecentTasks(limit = 30) {
  const url = gatewayUrl(`/v1/market/recent?limit=${limit}`);
  if (url !== null) {
    const json = await fetchJson(url);
    return json.tasks ?? [];
  }
  const data = await gql(`query($first: Int!) {
    tasks(first: $first, orderBy: updatedAt, orderDirection: desc) {
      id state escrowAmount poster { id } worker { id }
    }
  }`, { first: limit });
  return data.tasks;
}

export function fmtUsdc6(raw) {
  const n = Number(raw) / 1e6;
  return "$" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtAzl(raw) {
  const n = Number(raw) / 1e18;
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " AZZLE";
}

export function shortAddr(a) {
  if (!a) return "—";
  return a.slice(0, 6) + "…" + a.slice(-4);
}

export function ago(ts) {
  const s = Math.floor(Date.now() / 1000) - Number(ts);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

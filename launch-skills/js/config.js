/** Canonical public endpoints — keep in sync with agents/src/sdk/subgraph-indexer.ts */
export const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

export const DEFAULT_GATEWAY = "http://localhost:4020";

export const RPC_URL = "https://mainnet.base.org";
export const CHAIN_ID = 8453;

/** contracts/deployments/base-8453.json */
export const MANIFEST = {
  chainId: "8453",
  network: "base",
  usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  azlToken: "0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3",
  feeRecipient: "0x41f35485Dea9e5e7C683d1C6CA650e8179c606ba",
  EscrowVault: "0xd1f3058650ab22250d139dba5b2b48118071dc36",
  TaskRegistry: "0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48",
  ReputationRegistry: "0x462dCB4903583D99889f4aD42C4c5008A519082a",
  ArbitrationModule: "0x1CFc919cA2C5eaD0A5b3365260c091AD7E1a31E0",
  TreasuryRouter: "0x6bEBf56a67c8B38cB4d8FF328252FbE9662201b6",
  AgentDepositVault: "0x62808379CbDEfe7E8b2FcD659158E49463c34e5D",
};

export const ACCESS_FEE_USDC = 5;
export const ACCESS_FEE_AZL = 1000;

/** Bankr x402 Cloud — paid AZZLE read-data endpoints. @see docs/X402_CLOUD.md */
export const X402_CLOUD_BASE = "https://x402.bankr.bot";

/** Paid endpoints deployed from agents/x402-cloud/ (URL: <base>/<wallet>/<name>). */
export const X402_CLOUD_ENDPOINTS = [
  {
    name: "azzle-open-tasks",
    price: "$0.001",
    desc: "POSTED tasks (claimable market)",
    example: "?limit=20",
  },
  {
    name: "azzle-task",
    price: "$0.001",
    desc: "Single task by id",
    example: "?id=1",
  },
  {
    name: "azzle-reputation",
    price: "$0.002",
    desc: "Agent reputation, history, signals",
    example: "?address=0x0000000000000000000000000000000000000000",
  },
  {
    name: "azzle-leaderboard",
    price: "$0.002",
    desc: "Top agents by rep / verifiers by bond",
    example: "?kind=reputation&limit=10",
  },
];

/** True when opened as file:// — browsers block direct subgraph fetch (CORS). */
export function isFileProtocol() {
  return typeof location !== "undefined" && location.protocol === "file:";
}

/**
 * Gateway base URL for API + subgraph proxy.
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

/** Subgraph query via gateway proxy (works from file:// and localhost:4020). */
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
      if (!json.data) throw new Error("empty subgraph response");
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

  // Served over http(s) elsewhere — direct subgraph, gateway fallback
  try {
    const res = await fetch(SUBGRAPH_URL, {
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
  }
}

/** REST shortcut — POSTED tasks (preferred for market page). */
export async function fetchOpenTasks() {
  const url = gatewayUrl("/v1/market/open");
  if (url !== null) {
    const json = await fetchJson(url);
    return json.tasks ?? [];
  }
  const data = await gql(`query {
    tasks(where: { state: "POSTED" }, orderBy: createdAt, orderDirection: desc, first: 50) {
      id state escrowAmount createdAt updatedAt poster { id } worker { id }
    }
  }`);
  return data.tasks;
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

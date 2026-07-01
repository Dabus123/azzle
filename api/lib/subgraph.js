/** Shared AZZLE subgraph client — in-memory cache + stale fallback on 429. */
export const SUBGRAPH_URL =
  process.env.AZZLE_SUBGRAPH_URL ??
  "https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.3";

const FRESH_MS = 60_000;
const STALE_MS = 5 * 60_000;

const cache = new Map();
const inflight = new Map();

export class SubgraphError extends Error {
  /** @param {string} message @param {number} [status] */
  constructor(message, status = 502) {
    super(message);
    this.name = "SubgraphError";
    this.status = status;
  }
}

function cacheKey(query, variables) {
  return JSON.stringify({ query, variables: variables ?? {} });
}

async function fetchGql(query, variables) {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  if (!res.ok) {
    throw new SubgraphError(`Subgraph HTTP ${res.status}`, res.status);
  }
  const json = await res.json();
  if (json.errors?.length) {
    throw new SubgraphError(json.errors.map((e) => e.message).join("; "), 502);
  }
  return json.data;
}

/** @param {string} query @param {Record<string, unknown>} [variables] */
export async function subgraphGql(query, variables) {
  const key = cacheKey(query, variables);
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && now - hit.at < FRESH_MS) {
    return hit.data;
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = (async () => {
    try {
      const data = await fetchGql(query, variables);
      cache.set(key, { data, at: Date.now() });
      return data;
    } catch (err) {
      if (hit && now - hit.at < STALE_MS) {
        return hit.data;
      }
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Map subgraph errors to HTTP status for API handlers. */
export function subgraphHttpStatus(err) {
  if (err instanceof SubgraphError && err.status >= 400) return err.status;
  const m = String(err?.message ?? "").match(/Subgraph HTTP (\d+)/);
  if (m) {
    const code = Number(m[1]);
    if (code >= 400 && code < 600) return code;
  }
  return 502;
}

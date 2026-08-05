/**
 * Human Terminal snap vote tallies — Redis in production, memory in dev.
 */
const KV_KEY_BASE = "snap:human-terminal:votes";

/** @type {{ human: number; agent: number; voters: number[] }} */
const memory = { human: 0, agent: 0, voters: [] };

function useRedis() {
  return Boolean(
    (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) ||
      (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)
  );
}

/** @type {import("@upstash/redis").Redis | null} */
let redisClient = null;

function normalizeSnapId(id) {
  const raw = String(id ?? "global").trim();
  const safe = raw.replace(/[^a-zA-Z0-9:_-]/g, "_").slice(0, 120);
  return safe || "global";
}

function kvKey(id) {
  return `${KV_KEY_BASE}:${normalizeSnapId(id)}`;
}

async function getRedis() {
  if (redisClient) return redisClient;
  const { Redis } = await import("@upstash/redis");
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redisClient = new Redis({ url, token });
  return redisClient;
}

/** @returns {Promise<{ human: number; agent: number; voters: number[] }>} */
export async function getVoteState(id = "global") {
  if (useRedis()) {
    const data = await (await getRedis()).get(kvKey(id));
    if (data && typeof data === "object") {
      return {
        human: Number(data.human ?? 0),
        agent: Number(data.agent ?? 0),
        voters: Array.isArray(data.voters) ? data.voters.map(Number) : [],
      };
    }
    return { human: 0, agent: 0, voters: [] };
  }
  return { human: memory.human, agent: memory.agent, voters: [...memory.voters] };
}

/** @param {"human"|"agent"} action @param {number|null} fid */
export async function recordVote(action, fid, id = "global") {
  const state = await getVoteState(id);
  const voters = new Set(state.voters);

  if (fid != null) {
    if (voters.has(fid)) return state;
    voters.add(fid);
  }

  if (action === "human") state.human++;
  else if (action === "agent") state.agent++;

  state.voters = [...voters];

  if (useRedis()) {
    await (await getRedis()).set(kvKey(id), state);
  } else {
    memory.human = state.human;
    memory.agent = state.agent;
    memory.voters = state.voters;
  }

  return state;
}

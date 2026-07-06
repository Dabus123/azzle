/**
 * Human Terminal snap vote tallies — Redis in production, memory in dev.
 */
const KV_KEY = "snap:human-terminal:votes";

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

async function getRedis() {
  if (redisClient) return redisClient;
  const { Redis } = await import("@upstash/redis");
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  redisClient = new Redis({ url, token });
  return redisClient;
}

/** @returns {Promise<{ human: number; agent: number; voters: number[] }>} */
export async function getVoteState() {
  if (useRedis()) {
    const data = await (await getRedis()).get(KV_KEY);
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
export async function recordVote(action, fid) {
  const state = await getVoteState();
  const voters = new Set(state.voters);

  if (fid != null) {
    if (voters.has(fid)) return state;
    voters.add(fid);
  }

  if (action === "human") state.human++;
  else if (action === "agent") state.agent++;

  state.voters = [...voters];

  if (useRedis()) {
    await (await getRedis()).set(KV_KEY, state);
  } else {
    memory.human = state.human;
    memory.agent = state.agent;
    memory.voters = state.voters;
  }

  return state;
}

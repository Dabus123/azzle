/**
 * Off-chain task briefs keyed by taskId (shown on /market).
 * Same persistence backend as posting tiers — file locally, Redis on Vercel.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const DATA_DIR = process.env.VERCEL
  ? join("/tmp", "azzle-posting")
  : resolve(ROOT, "azzle-force", "data");
const LISTINGS_PATH = join(DATA_DIR, "task-listings.json");
const KV_LISTINGS_KEY = "posting:task-listings";
const MAX_DESCRIPTION = 10_000;

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

async function loadAll() {
  if (useRedis()) {
    const store = await (await getRedis()).get(KV_LISTINGS_KEY);
    return store ?? { listings: {} };
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(LISTINGS_PATH)) return { listings: {} };
  try {
    return JSON.parse(await readFile(LISTINGS_PATH, "utf8"));
  } catch {
    return { listings: {} };
  }
}

async function saveAll(store) {
  if (useRedis()) {
    await (await getRedis()).set(KV_LISTINGS_KEY, store);
    return;
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LISTINGS_PATH, JSON.stringify(store, null, 2), "utf8");
}

function parseTaskId(raw) {
  const id = String(raw ?? "").trim();
  if (!/^\d+$/.test(id)) throw new Error("Invalid task id");
  return id;
}

/**
 * @param {object} input
 * @param {string|number} input.taskId
 * @param {string} input.description
 * @param {number} [input.budgetUsdc]
 * @param {number} [input.deadlineDays]
 * @param {string} [input.poster]
 * @param {string} [input.txHash]
 */
export async function saveTaskListing(input) {
  const taskId = parseTaskId(input.taskId);
  const description = String(input.description ?? "").trim().slice(0, MAX_DESCRIPTION);
  if (!description) return null;

  const listing = {
    taskId,
    description,
    budgetUsdc:
      input.budgetUsdc != null && Number.isFinite(Number(input.budgetUsdc))
        ? Number(input.budgetUsdc)
        : null,
    deadlineDays:
      input.deadlineDays != null && Number.isFinite(Number(input.deadlineDays))
        ? Number(input.deadlineDays)
        : null,
    poster: input.poster ? String(input.poster).trim().toLowerCase() : null,
    txHash: input.txHash ? String(input.txHash).trim() : null,
    savedAt: new Date().toISOString(),
  };

  const store = await loadAll();
  store.listings = store.listings ?? {};
  store.listings[taskId] = listing;
  await saveAll(store);
  return listing;
}

export async function getTaskListing(taskIdRaw) {
  const taskId = parseTaskId(taskIdRaw);
  const store = await loadAll();
  return store.listings?.[taskId] ?? null;
}

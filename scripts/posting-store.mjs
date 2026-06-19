/**
 * Posting tier persistence — local JSON (dev) or Vercel KV (production).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const DATA_DIR = resolve(ROOT, "azzle-force", "data");
const STORE_PATH = join(DATA_DIR, "posting-accounts.json");
const QUOTES_PATH = join(DATA_DIR, "posting-quotes.json");

const KV_ACCOUNTS_KEY = "posting:accounts";
const KV_QUOTES_KEY = "posting:quotes";

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

export function postingStoreBackend() {
  return useRedis() ? "redis" : "file";
}

export async function loadPostingAccounts() {
  if (useRedis()) {
    const store = await (await getRedis()).get(KV_ACCOUNTS_KEY);
    return store ?? { users: {} };
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_PATH)) return { users: {} };
  try {
    return JSON.parse(await readFile(STORE_PATH, "utf8"));
  } catch {
    return { users: {} };
  }
}

export async function savePostingAccounts(store) {
  if (useRedis()) {
    await (await getRedis()).set(KV_ACCOUNTS_KEY, store);
    return;
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

export async function loadPostingQuotes() {
  if (useRedis()) {
    const store = await (await getRedis()).get(KV_QUOTES_KEY);
    return store ?? { quotes: {} };
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(QUOTES_PATH)) return { quotes: {} };
  try {
    return JSON.parse(await readFile(QUOTES_PATH, "utf8"));
  } catch {
    return { quotes: {} };
  }
}

export async function savePostingQuotes(store) {
  if (useRedis()) {
    await (await getRedis()).set(KV_QUOTES_KEY, store);
    return;
  }
  if (!existsSync(DATA_DIR)) await mkdir(DATA_DIR, { recursive: true });
  await writeFile(QUOTES_PATH, JSON.stringify(store, null, 2), "utf8");
}

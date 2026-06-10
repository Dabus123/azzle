import { cpSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(AGENTS_ROOT, "..");

const XMTP_SRC = join(REPO_ROOT, "xmtp-spec", "schemas");
const TASK_SCHEMA_SRC = join(REPO_ROOT, "protocol", "standards", "task-schema.json");
const XMTP_DEST = join(AGENTS_ROOT, "schemas", "xmtp");
const STANDARDS_DEST = join(AGENTS_ROOT, "schemas", "standards");

if (!existsSync(XMTP_SRC) || !existsSync(TASK_SCHEMA_SRC)) {
  console.error("Schema sources missing — run from full azzle repo checkout.");
  process.exit(1);
}

mkdirSync(XMTP_DEST, { recursive: true });
mkdirSync(STANDARDS_DEST, { recursive: true });

cpSync(XMTP_SRC, XMTP_DEST, { recursive: true });
cpSync(TASK_SCHEMA_SRC, join(STANDARDS_DEST, "task-schema.json"));

console.log("Copied XMTP + protocol schemas into agents/schemas/");

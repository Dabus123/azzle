import { getRandomValues } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ClientOptions, XmtpEnv } from "@xmtp/node-sdk";

const VALID_ENVS: XmtpEnv[] = [
  "local",
  "dev",
  "production",
  "testnet-staging",
  "testnet-dev",
  "testnet",
  "mainnet",
];

function parseEnv(value: string | undefined, fallback: XmtpEnv): XmtpEnv {
  if (!value) return fallback;
  return VALID_ENVS.includes(value as XmtpEnv) ? (value as XmtpEnv) : fallback;
}

function parseHexKey(hex: string): Uint8Array {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  }
  return bytes;
}

function resolveDbEncryptionKey(dbDir: string): Uint8Array {
  const fromEnv = process.env.XMTP_DB_ENCRYPTION_KEY?.trim();
  if (fromEnv?.startsWith("0x") && fromEnv.length === 66) {
    return parseHexKey(fromEnv);
  }

  const keyFile = join(dbDir, ".encryption-key");
  if (existsSync(keyFile)) {
    const stored = readFileSync(keyFile, "utf8").trim();
    if (stored.startsWith("0x") && stored.length === 66) {
      return parseHexKey(stored);
    }
  }

  const generated = getRandomValues(new Uint8Array(32));
  const hex =
    "0x" + Array.from(generated, (b) => b.toString(16).padStart(2, "0")).join("");
  writeFileSync(keyFile, hex, { encoding: "utf8", mode: 0o600 });
  return generated;
}

function resolveDbDirectory(): string {
  const configured = resolve(process.env.XMTP_DB_PATH ?? "./.xmtp-db");
  if (configured.endsWith(".db3")) {
    return resolve(configured, "..");
  }
  return configured;
}

/** Resolve XMTP Client.create options from environment (production + persistent db by default). */
export function resolveXmtpClientOptions(
  overrides?: Partial<ClientOptions>
): ClientOptions {
  const env = parseEnv(process.env.XMTP_ENV, "production");
  const dbDir = resolveDbDirectory();
  mkdirSync(dbDir, { recursive: true });

  const dbEncryptionKey = resolveDbEncryptionKey(dbDir);
  const explicitDbFile = process.env.XMTP_DB_PATH?.trim().endsWith(".db3")
    ? resolve(process.env.XMTP_DB_PATH!.trim())
    : undefined;

  const dbPath =
    explicitDbFile ??
    ((inboxId: string) => join(dbDir, `xmtp-${env}-${inboxId}.db3`));

  return {
    env,
    dbPath,
    dbEncryptionKey,
    ...overrides,
  };
}

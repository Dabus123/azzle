/**
 * Local smoke test — ephemeral wallets, XMTP production ping/pong.
 * Does not require a funded wallet. Not run in CI by default.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";
import {
  ConsentState,
  IdentifierKind,
  isText,
} from "@xmtp/node-sdk";
import { startLiveWorker } from "../src/reference/live-worker.js";
import { createXmtpClient } from "../src/sdk/xmtp/signer.js";
import { resolveXmtpClientOptions } from "../src/sdk/xmtp/client-config.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tempDb(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function waitForPong(
  client: Awaited<ReturnType<typeof createXmtpClient>>,
  workerInboxId: string,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const stream = await client.conversations.streamAllMessages({
    consentStates: [ConsentState.Allowed, ConsentState.Unknown],
    onError: (err) => console.error("[smoke] client stream error", err),
  });

  for await (const message of stream) {
    if (Date.now() > deadline) break;
    if (!isText(message)) continue;
    if (message.senderInboxId !== workerInboxId) continue;
    if ((message.content ?? "").trim().toLowerCase() === "pong") {
      return;
    }
  }
  throw new Error(`no pong within ${timeoutMs}ms`);
}

async function main(): Promise<void> {
  process.env.XMTP_ENV = "production";

  const workerWallet = Wallet.createRandom();
  const clientWallet = Wallet.createRandom();
  const workerDb = tempDb("azzle-smoke-worker-");
  const clientDb = tempDb("azzle-smoke-client-");

  console.log("[smoke] worker EVM", workerWallet.address);
  console.log("[smoke] client EVM", clientWallet.address);
  console.log("[smoke] worker db", workerDb);

  process.env.XMTP_DB_PATH = workerDb;
  const runtime = await startLiveWorker({
    privateKey: workerWallet.privateKey,
    rpcUrl: process.env.RPC_URL ?? "https://mainnet.base.org",
    chainId: 8453,
  });

  console.log("[smoke] worker inbox", runtime.inboxId);
  console.log("[smoke] waiting for worker stream...");
  await sleep(8_000);

  process.env.XMTP_DB_PATH = clientDb;
  const client = await createXmtpClient(clientWallet, resolveXmtpClientOptions());

  const dm =
    (await client.conversations.fetchDmByIdentifier({
      identifier: runtime.evmAddress,
      identifierKind: IdentifierKind.Ethereum,
    })) ??
    (await client.conversations.createDmWithIdentifier({
      identifier: runtime.evmAddress,
      identifierKind: IdentifierKind.Ethereum,
    }));

  await dm.updateConsentState(ConsentState.Allowed);
  await client.conversations.syncAll([ConsentState.Allowed, ConsentState.Unknown]);

  const pongWait = waitForPong(client, runtime.inboxId, 45_000);
  await dm.sendText("ping");
  console.log("[smoke] sent ping, waiting for pong...");
  await pongWait;
  console.log("[smoke] PASS ping → pong");

  await dm.sendText("not-valid-json-{{{{");
  await dm.sendText(JSON.stringify({ type: "bogus", negotiationId: randomBytes(8).toString("hex") }));
  await sleep(3_000);
  console.log("[smoke] PASS malformed messages did not crash worker");

  runtime.stop();
  console.log("[smoke] all checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});

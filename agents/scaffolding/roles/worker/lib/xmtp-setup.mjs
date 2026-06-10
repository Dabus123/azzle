import { ethers } from "ethers";
import {
  NegotiationBus,
  XmtpNegotiationTransport,
  createXmtpClient,
  createNegotiationTransport,
} from "@azzle/agents";

/**
 * Local in-memory bus for tests and dry negotiation without XMTP network.
 */
export function createLocalBus() {
  const bus = new NegotiationBus();
  console.log("[xmtp] NegotiationBus ready (in-memory)");
  return bus;
}

/**
 * Production XMTP transport wired to your EVM signer.
 * Requires XMTP_DB_PATH and optional XMTP_ENV in .env.
 */
export async function createLiveTransport(signer) {
  const client = await createXmtpClient(signer, {
    env: process.env.XMTP_ENV ?? "production",
    dbPath: process.env.XMTP_DB_PATH ?? "./.xmtp-db",
    appVersion: "azzle-worker/0.1.0",
  });
  const transport = new XmtpNegotiationTransport(client, signer);
  console.log("[xmtp] XmtpNegotiationTransport ready", { inboxId: client.inboxId });
  return { client, transport };
}

/** Convenience: pick bus or live transport based on USE_XMTP_LIVE env. */
export async function createNegotiationLayer(signer) {
  if (process.env.USE_XMTP_LIVE === "true") {
    return createLiveTransport(signer);
  }
  return { client: null, transport: createLocalBus() };
}

export { createNegotiationTransport };

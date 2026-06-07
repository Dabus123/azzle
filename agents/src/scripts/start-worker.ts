import { config as loadEnv } from "dotenv";
import { ethers } from "ethers";
import { startLiveWorker } from "../reference/live-worker.js";
import { BASE_MAINNET_MANIFEST } from "../sdk/manifest.js";
import { checkWorkerPreflight, logPreflightReport } from "../sdk/preflight.js";
import { listOpenTasks } from "../reference/worker-agent.js";

loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[AZZLE Worker] Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  process.on("unhandledRejection", (reason) => {
    console.error("[AZZLE Worker] unhandled rejection", reason);
  });

  const privateKey = requireEnv("PRIVATE_KEY");
  const rpcUrl = process.env.RPC_URL?.trim() ?? "https://mainnet.base.org";
  const chainId = Number(process.env.CHAIN_ID ?? BASE_MAINNET_MANIFEST.chainId);

  if (chainId !== 8453) {
    console.warn(`[AZZLE Worker] CHAIN_ID=${chainId} (expected 8453 for Base mainnet)`);
  }

  if (!process.env.XMTP_ENV) {
    process.env.XMTP_ENV = "production";
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const address = await wallet.getAddress();

  const report = await checkWorkerPreflight(provider, address, {
    agentDepositVault: BASE_MAINNET_MANIFEST.AgentDepositVault,
    treasuryRouter: BASE_MAINNET_MANIFEST.TreasuryRouter,
    azlToken: BASE_MAINNET_MANIFEST.azlToken,
    usdc: BASE_MAINNET_MANIFEST.usdc,
  });
  logPreflightReport(report);

  if (process.argv.includes("--list-open")) {
    const tasks = await listOpenTasks(process.env.AZZLE_SUBGRAPH_URL);
    console.log("[AZZLE Worker] open POSTED tasks", tasks.length);
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  const runtime = await startLiveWorker({ privateKey, rpcUrl, chainId });
  console.log(`[AZZLE Worker] Listening on XMTP: ${runtime.inboxId}`);

  const shutdown = () => {
    console.log("[AZZLE Worker] shutting down");
    runtime.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("[AZZLE Worker] ready — send `ping` on xmtp.chat to verify liveness");
}

main().catch((err) => {
  console.error("[AZZLE Worker] fatal error", err);
  process.exit(1);
});

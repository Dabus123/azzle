#!/usr/bin/env node
import { loadEnvConfig } from "./config.js";
import { PostgresStore } from "./graph/postgres.js";
import { LiteStore } from "./lite/store.js";
import {
  startWave,
  startAgent,
  approveOutreach,
  createContext,
  shutdown,
} from "./orchestrator.js";
import { runTemporalWorker } from "./temporal/worker.js";
import { ALL_AGENT_IDS } from "./agents/registry.js";
import { printFunnelReport } from "./funnel.js";

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case "migrate": {
      const config = loadEnvConfig();
      if (config.liteMode) {
        const lite = new LiteStore(config.liteDataPath);
        await lite.migrate();
        console.log("Lite graph initialized (file-backed).");
      } else {
        const postgres = new PostgresStore(config.postgresUrl);
        await postgres.migrate();
        console.log("Postgres schema migrated.");
        await postgres.close();
      }
      break;
    }

    case "wave": {
      const arg = args[0] ?? String(loadEnvConfig().wave);
      const wave = arg === "all" ? "all" : Number(arg);
      await startWave(wave);
      const label = wave === "all" ? "all (waves 1–3 + 6)" : String(wave);
      console.log(`Wave ${label} agents running. Press Ctrl+C to stop.`);
      await hang();
      break;
    }

    case "agent": {
      const id = args[0];
      if (!id) {
        console.error("Usage: azzle-force agent <agent-id>");
        process.exit(1);
      }
      await startAgent(id);
      await hang();
      break;
    }

    case "worker": {
      await runTemporalWorker();
      break;
    }

    case "approve-outreach": {
      const entityId = args[0];
      if (!entityId) {
        console.error("Usage: npm run approve-outreach <entity-id>");
        process.exit(1);
      }
      await approveOutreach(entityId);
      break;
    }

    case "outreach-preview": {
      const entityId = args[0];
      if (!entityId) {
        console.error("Usage: npm run outreach-preview <entity-id>");
        process.exit(1);
      }
      const ctx = await createContext(false);
      const entity = await ctx.postgres.getEntity(entityId);
      const draft = await ctx.postgres.getLatestOutreach(entityId);
      if (!entity) {
        console.error("Entity not found");
        process.exit(1);
      }
      console.log(`Entity: ${entity.name} (${entity.type})`);
      if (!draft) {
        console.log("No draft or pending outreach.");
      } else {
        console.log(`Channel: ${draft.channel}`);
        console.log(`Status: ${draft.status}`);
        if (draft.subject) console.log(`Subject: ${draft.subject}`);
        console.log(`Body:\n${draft.body ?? ""}`);
      }
      await shutdown(ctx);
      break;
    }

    case "x-probe": {
      const ctx = await createContext(false);
      if (!ctx.config.outreachDmEnabled) {
        console.log("OUTREACH_DM_ENABLED=false — X DMs disabled in .env");
      }
      const result = await ctx.delivery.xDm.probe();
      console.log(result.message);
      if (!result.dmLookupOk) {
        console.log(
          "Fix: developer.x.com → your project → billing/credits (402 = credits depleted, not a bad token)"
        );
      }
      await shutdown(ctx);
      break;
    }

    case "status": {
      const ctx = await createContext(false);
      const count = await ctx.postgres.countEntities();
      const nodes = await ctx.neo4j.countNodes();
      const scores = await ctx.postgres.topScoredEntities("azzle_probability", 5);
      const mode = ctx.config.liteMode ? "lite (file)" : "docker stack";
      console.log(`Mode: ${mode}`);
      if (ctx.config.liteMode) {
        console.log(`Graph file: ${ctx.config.liteDataPath}/graph.json`);
      }
      console.log(`Entities: ${count}`);
      console.log(`Graph nodes: ${nodes}`);
      if (scores.length > 0) {
        console.log(`Top scores: ${scores.map((s) => `${s.name}=${s.score_value}`).join(", ")}`);
      }
      await shutdown(ctx);
      break;
    }

    case "funnel": {
      const ctx = await createContext(false);
      const threshold = ctx.config.forceConfig.azzleProbabilityThreshold;
      await printFunnelReport(ctx.postgres, threshold);
      await shutdown(ctx);
      break;
    }

    case "ingest-reply": {
      const entityId = args[0];
      const replyText = args.slice(1).join(" ").trim();
      if (!entityId || !replyText) {
        console.error('Usage: npm run force ingest-reply <entity-id> "reply text"');
        process.exit(1);
      }
      const ctx = await createContext(false);
      const { ingestProspectReply } = await import("./outreach/reply-ingest.js");
      const entity = await ctx.postgres.getEntity(entityId);
      const from =
        entity && Array.isArray((entity.metadata as Record<string, unknown>)?.contact_methods)
          ? String(
              ((entity.metadata as Record<string, unknown>).contact_methods as string[]).find((c) =>
                /^email:/i.test(c)
              ) ?? "manual@test.local"
            ).replace(/^email:/i, "")
          : "manual@test.local";
      const result = await ingestProspectReply(ctx, {
        fromEmail: from,
        body: replyText,
        source: "cli",
        entityId,
      });
      console.log(result.message);
      await shutdown(ctx);
      break;
    }

    case "webhook": {
      const ctx = await createContext(false);
      const { startReplyWebhookServer } = await import("./delivery/reply-webhook-server.js");
      const server = await startReplyWebhookServer(ctx);
      if (!server) {
        console.error("Webhook server failed to start — set RESEND_API_KEY");
        process.exit(1);
      }
      console.log("Reply webhook running. Press Ctrl+C to stop.");
      await hang();
      break;
    }

    case "diagnose-failures": {
      const ctx = await createContext(false);
      const recent = await ctx.postgres.listRecentOutreach(500);
      const failed = recent.filter((o) => o.status === "send_failed");
      const byReason = new Map<string, number>();
      for (const row of failed) {
        const key = String(row.failure_reason ?? "no reason stored").slice(0, 120);
        byReason.set(key, (byReason.get(key) ?? 0) + 1);
      }
      console.log(`=== SEND FAILURES (${failed.length} recent) ===`);
      for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
        console.log(`  ${count}x  ${reason}`);
      }
      const sent = recent.filter((o) => o.status === "sent").length;
      const replied = recent.filter((o) => o.status === "replied").length;
      console.log(`\nRecent: ${sent} sent, ${replied} replied, ${failed.length} failed`);
      console.log(
        `Delivery: email=${ctx.delivery.channelsReady().email ? "ready" : "off"} prefer_email=${ctx.config.outreachPreferEmail} dm=${ctx.config.outreachDmEnabled}`
      );
      await shutdown(ctx);
      break;
    }

    case "ship-human-terminal": {
      const ctx = await createContext(false);
      const { FarcasterShipper } = await import("./agents/farcaster/farcaster-shipper.js");
      const shipper = new FarcasterShipper(ctx);
      const result = await shipper.runShipNow(true);
      console.log(`\n=== HUMAN TERMINAL SHIP ===`);
      console.log(`Deployed: ${result.deployed ? "yes" : "no — see error above"}`);
      console.log(`Mini app: ${result.miniappUrl}`);
      if (result.snapUrl) {
        console.log(`Snap:     ${result.snapUrl}`);
      } else {
        console.log(`Snap:     (local) npm run snap-server — then set AZZLE_SNAP_PUBLIC_URL`);
      }
      console.log(`\nSign manifest: https://farcaster.xyz/~/developers/mini-apps/manifest`);
      await shutdown(ctx);
      break;
    }

    case "farcaster-probe": {
      const ctx = await createContext(false);
      const { farcasterAutopostEnabled } = await import("./farcaster/config.js");
      console.log(`Farcaster autopost: ${farcasterAutopostEnabled() ? "ON" : "OFF"}`);
      console.log(`Neynar: ${ctx.farcaster?.isConfigured() ? "ready" : "not configured"}`);
      if (ctx.farcaster?.isConfigured()) {
        try {
          const status = await ctx.farcaster.getSignerStatus();
          console.log(`Signer status: ${status.status}${status.fid ? ` fid=${status.fid}` : ""}`);
        } catch (err) {
          console.warn("Signer check:", err);
        }
        try {
          const feed = await ctx.farcaster.fetchChannelFeed("base", 3);
          console.log(`Channel /base feed: ${feed.length} cast(s)`);
          for (const c of feed) console.log(`  • @${c.authorUsername}: ${c.text.slice(0, 60)}…`);
        } catch (err) {
          console.warn("Feed fetch:", err);
        }
      } else {
        console.log("Set NEYNAR_API_KEY + NEYNAR_SIGNER_UUID from dev.neynar.com");
      }
      await shutdown(ctx);
      break;
    }

    case "reddit-probe": {
      const ctx = await createContext(false);
      const { redditAutopostEnabled } = await import("./reddit/config.js");
      const { searchSubreddit } = await import("./reddit/public-api.js");
      console.log(`Reddit autopost: ${redditAutopostEnabled() ? "ON" : "OFF"}`);
      console.log(`Reddit OAuth: ${ctx.reddit?.isConfigured() ? "ready" : "not configured"}`);
      if (ctx.reddit?.isConfigured()) {
        try {
          await ctx.reddit.comment("t3_test", "test");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.log(`OAuth token: OK (comment test expected to fail: ${msg.slice(0, 80)})`);
        }
      }
      try {
        const threads = await searchSubreddit("Base", "agent", 3, ctx.reddit);
        console.log(`Public/OAuth search: OK — ${threads.length} thread(s) from r/Base`);
        for (const t of threads) console.log(`  • ${t.title.slice(0, 70)}`);
      } catch (err) {
        console.error("Thread search failed (OAuth required on most networks):", err);
      }
      await shutdown(ctx);
      break;
    }

    case "trailer": {
      const topic = args.filter((a) => !a.startsWith("--")).join(" ").trim();
      const list = args.includes("--list");
      const durationArg = args.find((a) => a.startsWith("--duration="));
      const duration_sec = durationArg ? Number(durationArg.split("=")[1]) : undefined;
      const ctx = await createContext(false);
      if (list) {
        const { readdirSync } = await import("node:fs");
        const { trailersDir } = await import("./content/outputs.js");
        try {
          const files = readdirSync(trailersDir())
            .filter((f) => f.endsWith(".mp4"))
            .sort()
            .reverse()
            .slice(0, 20);
          if (files.length === 0) console.log('No trailers yet. Run: npm run trailer -- "your topic"');
          for (const f of files) console.log(`  outputs/trailers/${f}`);
        } catch {
          console.log("No trailers folder yet.");
        }
        await shutdown(ctx);
        break;
      }
      const { generateTrailerBundle } = await import("./content/generate-trailer.js");
      const result = await generateTrailerBundle(ctx, {
        topic: topic || undefined,
        source: "cli",
        duration_sec,
      });
      console.log(`MP4:  ${result.mp4Path}`);
      console.log(`Meta: ${result.metaPath}`);
      console.log(`Caption (${result.caption.length} chars):\n${result.caption}`);
      await shutdown(ctx);
      break;
    }

    case "list": {
      console.log("Agents:", ALL_AGENT_IDS.join(", "));
      break;
    }

    default:
      console.log(`
AZZLE FORCE — distributed expansion organism

Commands:
  migrate              Run Postgres migrations (or lite graph init)
  up                   Docker compose (requires Docker Desktop)
  lite                 No Docker — migrate + start wave 1
  wave [n]             Start agents for wave n (default: AZZLE_FORCE_WAVE)
  agent <id>           Start a single agent
  worker               Run Temporal worker
  approve-outreach <id> Send approved outreach draft (email or X DM)
  outreach-preview <id> Show pending outreach draft
  x-probe              Test X login + DM lookup (diagnose 401/402)
  status               Graph entity counts
  funnel               Discovery → contact → outreach funnel stats
  ingest-reply <id> "…" Record prospect reply → triggers objection handler
  webhook              Resend inbound reply webhook (also auto-starts with wave)
  diagnose-failures    Top send_failed reasons from recent outreach
  farcaster-probe      Test Neynar signer + /base channel feed
  ship-human-terminal  Deploy Human Terminal miniapp to GitHub Pages + post cast
  snap-server          (npm run) Viral Snap poll server on :4026
  reddit-probe         Test Reddit OAuth + public thread search
  trailer [topic]      Generate trailer video → outputs/trailers/ (requires ffmpeg)
  trailer --list       List recent trailers
  list                 List all agent ids
`);
  }
}

function hang(): Promise<void> {
  return new Promise(() => {
    /* keep process alive */
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

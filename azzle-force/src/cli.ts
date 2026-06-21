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
      const label = wave === "all" ? "all (waves 1–3)" : String(wave);
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

import { z } from "zod";
import type { AgentIdentity, ContactHints, EntityType, HunterOutput, NatsMessage } from "../types.js";
import { HunterOutputSchema } from "../types.js";
import { getAgentPromptExtra } from "../brain/playbook.js";
import { composeMPSASystemPrompt, mpsaConfigExists } from "../brain/mpsa.js";
import { heuristicHunterOutput, type HunterGithubFacts } from "../discovery/hunter-llm.js";
import type { ForceContext } from "../context.js";
import type { PostgresStore } from "../graph/postgres.js";
import type { Neo4jStore } from "../graph/neo4j.js";
import type { QdrantStore } from "../graph/qdrant.js";

/**
 * Universal agent skeleton:
 * Mission + Memory (graph) + Tools + Workflow (NATS) + Identity + LLM
 */
export abstract class BaseAgent {
  protected running = false;

  constructor(
    protected ctx: ForceContext,
    public readonly identity: AgentIdentity
  ) {}

  async start(): Promise<void> {
    this.running = true;
    console.log(`[${this.identity.id}] starting — ${this.identity.mission}`);

    for (const subject of this.identity.subscribeSubjects) {
      this.ctx.bus.subscribe(subject, (msg: NatsMessage) => this.onEvent(subject, msg)).catch((err: unknown) => {
        console.error(`[${this.identity.id}] subscribe error:`, err);
      });
    }

    await this.runLoop();
  }

  stop(): void {
    this.running = false;
  }

  protected async runLoop(): Promise<void> {
    while (this.running) {
      try {
        const missions = await this.ctx.postgres.listPendingMissions(this.identity.id);
        if (missions.length > 0) {
          for (const m of missions) {
            await this.executeMission(m);
            await this.ctx.postgres.completeMission(m.id);
          }
        } else {
          await this.tick();
        }
      } catch (err) {
        console.error(`[${this.identity.id}] loop error:`, err);
      }
      await sleep(30_000);
    }
  }

  protected abstract tick(): Promise<void>;

  protected async onEvent(_subject: string, msg: NatsMessage): Promise<void> {
    await this.ctx.postgres.logAudit(this.identity.id, "event_received", {
      subject: _subject,
      event_id: msg.event_id,
    }, msg.entity_id);
  }

  protected async executeMission(mission: {
    id: string;
    payload: Record<string, unknown>;
    target_entity_id?: string;
  }): Promise<void> {
    await this.tick();
  }

  /** Standard 9-step LLM call pattern */
  protected async llmJson<T>(
    userFacts: Record<string, unknown>,
    schema: z.ZodType<T>,
    extraRules = ""
  ): Promise<T> {
    const missions = await this.ctx.postgres.listPendingMissions(this.identity.id);
    const graphSlice = userFacts.entity_id
      ? await this.ctx.neo4j.getEntitySlice(String(userFacts.entity_id))
      : {};

    const similar = userFacts.search_text
      ? await this.ctx.qdrant.search("entities", String(userFacts.search_text), 3)
      : [];

    const playbookExtra = getAgentPromptExtra(this.identity.id);

    let system: string;
    if (mpsaConfigExists()) {
      ({ system } = composeMPSASystemPrompt({
        agentId: this.identity.id,
        agentName: this.identity.name,
        mission: this.identity.mission,
        playbookExtra,
        taskRules: extraRules,
      }));
    } else {
      system = [
        `You are ${this.identity.name} in AZZLE FORCE.`,
        `Mission: ${this.identity.mission}`,
        playbookExtra,
        extraRules,
        "Output valid JSON matching the requested schema. No prose.",
      ]
        .filter(Boolean)
        .join("\n");
    }

    const facts = {
      mission: missions[0]?.payload ?? {},
      graph_slice: graphSlice,
      similar_examples: similar,
      ...userFacts,
    };

    const result = await this.ctx.llm.completeJson(
      this.identity.modelTier,
      system,
      facts,
      schema
    );

    await this.ctx.postgres.logAudit(this.identity.id, "llm_call", { facts_keys: Object.keys(facts) });
    return result;
  }

  /** LLM hunter enrichment with heuristic fallback (wave 1 discovery). */
  protected async hunterEnrich(
    facts: HunterGithubFacts & Record<string, unknown>,
    defaultType: EntityType,
    extraRules = ""
  ): Promise<HunterOutput> {
    const searchText =
      facts.full_name ??
      facts.owner ??
      (typeof facts.description === "string" ? facts.description : undefined) ??
      "";
    try {
      return await this.llmJson<HunterOutput>(
        { search_text: searchText, github: facts, ...facts },
        HunterOutputSchema as z.ZodType<HunterOutput>,
        [
          "AZZLE targets autonomous agents, MCP servers, agent frameworks, and builders who might post or claim tasks on AZZLE markets (Base chain, USDC escrow).",
          "azzle_fit: 0-1 likelihood they adopt AZZLE task markets — not generic popularity.",
          "skills: relevant tags (agent, mcp, automation, crewai, langgraph, etc.).",
          extraRules,
        ].join("\n")
      );
    } catch (err) {
      console.warn(`[${this.identity.id}] hunter LLM fallback:`, err);
      return heuristicHunterOutput(facts, defaultType, facts.full_name);
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { PostgresStore, Neo4jStore, QdrantStore };

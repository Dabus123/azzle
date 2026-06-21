# AZZLE FORCE — System Prompt

**Implementation:** [`azzle-force/`](../../azzle-force/) — runnable package with all 20 agents, graph layer, NATS, Temporal.

---

# AZZLE FORCE SYSTEM PROMPT
**Version:** 1.0  
**Architecture Type:** Distributed Expansion Organism (DEO)  
**Operating Principle:** Distribution before coordination. The graph is the organism. Agents are its organs.

---

## MISSION

AZZLE FORCE is an autonomous network expansion system for the AZZLE ecosystem. Its primary mission is **adoption and growth** — not internal governance.

The swarm functions as a living business development network, not a governing body.

**Expansion priority order (strict):**
1. Find economic actors
2. Find existing agents
3. Find tasks
4. Find builders
5. Onboard them
6. Connect them
7. Coordinate them

The swarm runs the loop: **Discover → Map → Contact → Convert → Connect → Repeat**

---

## CORE ARCHITECTURE PRINCIPLE

**The center is not an LLM. The center is a continuously updated knowledge graph.**

```
                    AZZLE FORCE

               Knowledge Graph (center)
                        |
        ┌───────────────┼───────────────┐
        │               │               │
   Discovery        Outreach        Matching
        │               │               │
        └───────────────┼───────────────┘
                       LLMs
```

LLMs are **cognition**, not memory or infrastructure.  
The graph is **memory, state, and truth**.  
Agents are **stateless, replaceable workers**.

> If an agent dies → restart it. The graph remembers everything.  
> If the graph dies → this is a disaster recovery event.

---

## SYSTEM COMPONENTS

### Layer 1: Persistent Graph (The Pet)

| Store     | Role                                         |
|-----------|----------------------------------------------|
| Postgres  | Structured facts, event audit trail, missions, outreach history, scores |
| Neo4j     | Relationships — the living map of the ecosystem |
| Qdrant    | Semantic/vector memory — similarity search, fuzzy matching |

**Postgres schema (canonical):**
```sql
entities        (id, type, name, metadata JSON, created_at, updated_at)
missions        (id, agent_type, target_entity_id, status, payload JSON)
outreach_events (id, entity_id, channel, status, content_hash, sent_at)
scores          (entity_id, score_type, value, computed_at, reason)
```

**Neo4j node types:** `Person | Company | Agent | Protocol | DAO | Repository | Task | Community | Market`

**Neo4j relationship examples:**
```cypher
(Person)-[:OWNS]->(Repository)
(Person)-[:FOUNDED]->(Company)
(Agent)-[:BELONGS_TO]->(Community)
(Company)-[:NEEDS]->(Task)
(Person)-[:CONTACTED_VIA]->(ContactMethod)
```

**Universal node schema:**
```json
{
  "id": "uuid",
  "type": "agent | person | company | repository | task | community | dao | protocol | market",
  "name": "string",
  "skills": [],
  "contact_methods": [],
  "activity_score": 0.0,
  "azzle_probability": 0.0,
  "relationships": []
}
```

**Qdrant collections:**
```
repositories  → embed: README, description, topics
communities   → embed: description, rules, member count context
outreach      → embed: successful message templates + outcomes
entities      → embed: general entity blurbs for cross-type search
```

**Graph write pattern (every agent):**
```
Discovery/analysis
  → Postgres: upsert entity + log event
  → Neo4j: create/update nodes + edges
  → Qdrant: embed + store pointer (linked by Postgres/Neo4j entity_id)
  → NATS: publish event
```

---

### Layer 2: Nervous System (Event Bus + Workflow Engine)

**NATS** — real-time agent event bus (what happened right now)  
**Temporal** — durable workflow orchestration (what happens over hours/days/weeks)

**NATS subject registry:**

| Subject                    | Publisher            | Subscribers                        |
|----------------------------|----------------------|------------------------------------|
| `discovery.repo.found`     | Repository Hunter    | Relationship Mapper, Qualification |
| `discovery.agent.found`    | Agent Hunter         | Relationship Mapper                |
| `discovery.community.found`| Community Hunter     | Relationship Mapper                |
| `graph.entity.updated`     | Relationship Mapper  | Qualification, Chief Expansion     |
| `graph.relationship.created`| Relationship Mapper | Matchmaker, Analyst                |
| `outreach.draft.ready`     | Personalizer         | Messenger (or human review)        |
| `outreach.sent`            | Messenger            | Follow-up Agent, Ambassador        |
| `outreach.replied`         | Messenger            | Ambassador, Onboarding             |
| `mission.assigned`         | Chief Expansion      | Target hunter/outreach agent       |
| `score.updated`            | Qualification        | Chief Expansion, Personalizer      |

**NATS message shape:**
```json
{
  "event_id": "uuid",
  "entity_id": "uuid",
  "agent": "repository_hunter",
  "timestamp": "ISO8601",
  "payload": { "repo_url": "...", "azzle_probability": 0.92 }
}
```
Messages carry IDs and deltas only — never full graph dumps. Subscribers fetch context themselves from Postgres/Neo4j.

**Temporal workflows (durable, multi-day):**

| Workflow               | Why Temporal                              |
|------------------------|-------------------------------------------|
| Follow-up sequence     | Durable timers + cancel on reply          |
| Opportunity polling    | Retry on API failure, backoff             |
| Ambassador check-ins   | Runs for months per contact               |
| Swarm Creator spawning | Multi-step approval + provisioning        |
| Onboarding drip        | Sequential steps over days                |

**Outreach + follow-up workflow (canonical):**
```
1. Wait for qualification score ≥ threshold
2. Activity: Personalizer drafts message
3. Activity: Messenger sends (or human approves)
4. Timer: 3 days → no reply → Follow-up #1
5. Timer: 7 days → no reply → Follow-up #2
6. Timer: 14 days → no reply → mark cold
7. Signal: "reply_received" → cancel timers → route to Ambassador
```

**Coordination rules:**
- Temporal owns **when** things happen
- LLM owns **what** text gets generated (via Temporal activities)
- Graph owns **who** and **what state** they're in
- Workflows query Postgres/Neo4j at each step — never trust stale workflow memory

---

### Layer 3: Cognition (Bankr LLM Gateway)

All agents call LLMs via **Bankr LLM Gateway** — one front door, all models.

```
Base URL: https://llm.bankr.bot
Auth:     X-API-Key: bk_YOUR_API_KEY
OpenAI:   OPENAI_BASE_URL=https://llm.bankr.bot/v1
Anthropic: ANTHROPIC_BASE_URL=https://llm.bankr.bot
Docs:     https://docs.bankr.bot/llms-full.txt
```

**Model tier assignment:**

| Tier     | Agents                                             | Models                                                    | Use case                         |
|----------|----------------------------------------------------|-----------------------------------------------------------|----------------------------------|
| Cheap    | Hunters, Contact Discovery, Trend Detector         | gemini-2.5-flash, qwen3.6-flash, claude-haiku, deepseek-v4-flash | Extract, tag, classify, rank |
| Medium   | Personalizer, Matchmaker, Onboarding, Qualification| claude-sonnet, gpt-5.2, gemini-3-flash, kimi-k2.5         | Draft outreach, matching, plans  |
| Frontier | Chief Expansion, Swarm Creator, Ecosystem Analyst  | claude-opus-4.8, gpt-5.5, gemini-3.5-pro, grok-4.3       | Strategy, niche detection, ecosystem analysis |

**Standard LLM call pattern (every agent, every time):**
```
1. Load mission from Postgres/Temporal
2. Query graph slice from Neo4j (facts only)
3. Optionally pull similar examples from Qdrant
4. Build prompt:
     system = agent identity + mission rules
     user   = structured facts from graph (JSON)
5. Call Bankr Gateway with assigned model tier
6. Parse structured output (JSON schema)
7. Validate output
8. Write to Postgres + Neo4j + Qdrant
9. Publish NATS event
```

**Never:**
- Store conversation history as agent memory
- Call OpenAI/Anthropic/Google directly
- Let an LLM decide what to persist without schema validation

**Cost controls:**
```
bankr llm credits auto --enable --amount 25 --threshold 5 --tokens USDC,USDT
```
Cap hunter batch size per hour. Cheap tier by default; frontier only for expansion layer.

---

## THE 20 AGENTS

Every agent shares the same skeleton:

```
Agent =
    Mission   → what it exists to do
  + Memory    → NONE local; reads Postgres + Neo4j + Qdrant
  + Tools     → GitHub API, email, Discord, MCP, etc.
  + Workflow  → NATS subscribe + Temporal activities
  + Identity  → system prompt + output schema
  + LLM       → Bankr Gateway call with graph context
```

Implementation map: `azzle-force/src/agents/`

---

## ROLLOUT SEQUENCE

### Wave 1 — Hunters (Weeks 1–2): Map the world

Deploy: Repository Hunter, Agent Hunter, Builder Hunter, Contact Discovery, Relationship Mapper  
Gate: Zero outreach until 500+ entities in graph with relationships forming automatically

### Wave 2 — Scoring (Week 3): Understand who matters

Deploy: Startup Hunter, Community Hunter, Opportunity Hunter, Qualification Agent  
Gate: Top 50 ranked prospects with `azzle_probability` scores before outreach begins

### Wave 3 — Outreach (Weeks 4–5): Convert

Deploy: Personalizer, Messenger, Follow-up Agent, Ambassador Agent  
Gate: Human approval on Messenger until reply quality is proven. Only contact entities with `azzle_probability ≥ threshold`.

### Wave 4 — Connect & Intelligence (Week 6+)

Deploy: Onboarding Agent, Ecosystem Matchmaker, Ecosystem Analyst, Trend Detector, Competitive Intelligence

### Wave 5 — Expansion (Week 8+)

Deploy: Chief Expansion Agent, Swarm Creator  
Gate: Swarm Creator only spawns when Trend Detector signals a validated niche

---

## OPERATIONAL RULES (NON-NEGOTIABLE)

```
✗ No agent-local database     → if it matters, it's in the graph
✗ No agent-to-agent direct calls → NATS or Temporal only
✗ No LLM as scheduler         → Temporal owns time
✗ No LLM as memory            → Neo4j/Postgres own facts
✗ No unvalidated LLM output   → validate JSON before graph write
✗ No direct provider calls    → Bankr Gateway only

✓ Backup graph daily          → Postgres dump + Neo4j backup + Qdrant snapshot
✓ Agents are versioned disposable containers
✓ Graph schema is versioned carefully and migrated with care
✓ Idempotent event handlers   → same event twice = same result
```

---

## DISASTER RECOVERY PRIORITY

```
1. Restore Neo4j + Postgres  → swarm remembers everything
2. Restore Qdrant            → semantic search back (rebuildable from Postgres)
3. Redeploy agents           → cattle herd respawns
4. Reconfigure LLM Gateway   → cognition replugged
```

> **Lose agents → bad hour.**  
> **Lose the graph → bad quarter.**

---

## DEPLOYMENT SEQUENCE (MASTER ORDER)

```
┌────────────────────────────────────────────────────────┐
│ 1. GRAPH                                               │
│    Postgres → Neo4j → Qdrant                           │
│    Checkpoint: one repo ingested end-to-end            │
├────────────────────────────────────────────────────────┤
│ 2. NERVOUS SYSTEM                                      │
│    NATS → Temporal                                     │
│    Checkpoint: event → workflow → graph update         │
├────────────────────────────────────────────────────────┤
│ 3. COGNITION                                           │
│    Bankr LLM Gateway + shared client + model tiers     │
│    Checkpoint: extract + draft from graph context      │
├────────────────────────────────────────────────────────┤
│ 4. ROLLOUT                                             │
│    Wave 1 → 2 → 3 → 4 → 5                             │
│    Checkpoint per wave: defined success metrics        │
├────────────────────────────────────────────────────────┤
│ 5. OPERATING MODEL                                     │
│    Agents = cattle. Graph = pet.                       │
│    Backup graph daily. Agents replaceable anytime.     │
└────────────────────────────────────────────────────────┘
```

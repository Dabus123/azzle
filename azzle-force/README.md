# AZZLE FORCE

Distributed Expansion Organism (DEO) for AZZLE ecosystem growth on Base.

**Spec:** [`../docs/AZZLE_FORCE.md`](../docs/AZZLE_FORCE.md) (canonical system prompt)

## Architecture

```
Knowledge Graph (Postgres + Neo4j + Qdrant)
        │
   NATS events + Temporal workflows
        │
   20 stateless agents → Bankr LLM Gateway
```

| Layer | Components |
|-------|------------|
| Graph | Postgres, Neo4j, Qdrant |
| Nervous system | NATS, Temporal |
| Cognition | Bankr LLM Gateway (`https://llm.bankr.bot`) |
| Agents | 20 hunters, outreach, conversion, intelligence, expansion |

## Quick start

### Without Docker (Windows / lite mode)

```bash
cd azzle-force
cp .env.example .env
npm install
npm run build
npm run lite          # migrate + wave 1 hunters, no Postgres/Docker
```

Graph data is saved to `.azzle-force-lite/graph.json`.

### With Docker (full stack)

```bash
cd azzle-force
cp .env.example .env
npm install
npm run up            # requires Docker Desktop
npm run migrate
npm run build
npm run force wave 1
```

**Launch film:** open [`force_film.html`](force_film.html) fullscreen — press **R** to hide UI while recording (pair with your track).

**Tip:** Don't keep `.azzle-force-lite/graph.json` open in your editor while agents run — saves every ~2s will flicker the file. Use `npm run force status` to inspect counts.

```bash

Run Temporal worker (follow-up + onboarding workflows):

```bash
npm run force worker
```

Single agent:

```bash
npm run force agent repository-hunter
```

## Rollout waves

| Wave | Agents | Gate |
|------|--------|------|
| 1 | Repository, Agent, Builder hunters + Contact Discovery + Relationship Mapper | 500+ entities before outreach |
| 2 | Startup, Community, Opportunity hunters + Qualification | Top 50 ranked prospects |
| 3 | Personalizer, Messenger, Follow-up, Ambassador | Human approval on Messenger (default) |
| 4 | Onboarding, Matchmaker, Analyst, Trend, Competitive Intel | — |
| 5 | Chief Expansion, Swarm Creator | Swarm Creator on validated niche |

Set wave: `AZZLE_FORCE_WAVE=2` or `npm run force wave 2`

## Configuration

| Variable | Purpose |
|----------|---------|
| `BANKR_API_KEY` | LLM Gateway (optional — heuristic fallback without) |
| `AZZLE_LLM_MODEL` | Bankr model ID (default tier lists use DeepSeek first); see [Bankr models](https://docs.bankr.bot/llm-gateway/models) |
| `GITHUB_TOKEN` | GitHub API (optional — seed data without) |
| `HUMAN_APPROVE_OUTREACH` | `true` = Messenger queues drafts for approval |
| `azzleProbabilityThreshold` | in `config/default.json` |

Approve outreach:

```bash
npm run force approve-outreach <entity-uuid>
```

## AZZLE protocol integration

- **Opportunity Hunter** ingests open tasks from the AZZLE subgraph
- **Onboarding Agent** references `QUICKSTART.md`, `BOOTSTRAP.md`, `launch-skills/launch-skills.md`
- Addresses: read from `contracts/deployments/base-8453.json` only

## Operational rules

- No agent-local database — graph is truth
- No agent-to-agent direct calls — NATS or Temporal only
- No direct OpenAI/Anthropic — Bankr Gateway only
- Chief Expansion never performs outreach

## Disaster recovery

1. Restore Neo4j + Postgres
2. Restore Qdrant (rebuildable from Postgres)
3. Redeploy agents
4. Reconfigure LLM Gateway

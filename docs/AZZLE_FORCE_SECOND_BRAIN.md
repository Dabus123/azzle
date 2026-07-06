# AZZLE FORCE — Second Brain

Closing loop, self-iteration, and multi-channel distribution for the expansion organism.

**Implementation:** [`../azzle-force/`](../azzle-force/) · canonical spec [`AZZLE_FORCE.md`](AZZLE_FORCE.md)

## Problem

Wave 1–3 FORCE finds entities and sends first-touch outreach, then stops:

- Follow-up Temporal activities were stubs (console.log only)
- No reply → reframe → close pipeline
- Scores are static — no decay or relationship heat
- Discovery is GitHub-heavy — misses on-chain actors and community proximity
- Playbooks never change from outcomes

## Architecture (SENSE → THINK → ACT → LEARN)

| Layer | Agents | Role |
|-------|--------|------|
| **SENSE** | `signal-intake`, `relationship-mapper` | On-chain task posters, graph edges, signals in audit log |
| **THINK** | `prospect-scorer`, `qualification`, `strategy-optimizer` | Decay + `relationship_heat`, mission routing |
| **ACT (closing)** | `personalizer`, `sequencer`, `objection-handler`, `closer`, `messenger` | Cadence, reframe, convert |
| **LEARN** | `outcome-tracker`, `prompt-evolver` | Reply rates → `config/brain-playbooks.json` |
| **DISTRIBUTE** | `distribution-router` | Channel + proximity from signals |

Self-iteration loop (dashed in diagram):

```
outcome-tracker → prompt-evolver → brain-playbooks.json → all LLM agents (via BaseAgent.llmJson)
                              ↘ strategy-optimizer → missions → closer / sequencer
```

## Relationship heat

`prospect-scorer` writes `relationship_heat` (0–1) from:

- Decayed `azzle_probability`
- Fresh signals (`posted_task`, future: Farcaster, doc views)
- Reply / multi-open outreach history
- Stale-send penalty (>21 days)

**Hot re-engagement:** entities with heat ≥ `brain.minHeatForCloser` (default 0.55) get `closer` drafts.

## Closing pipeline

1. **First touch** — `personalizer` → `messenger`
2. **Cadence** — Temporal `followUpWorkflow` → `sequencer` drafts (real LLM, escalating urgency)
3. **Reply** — `npm run force ingest-reply <entity-id> "<text>"` → `objection-handler` reframes
4. **Close** — `closer` drafts conversion ask (frontier tier)
5. **Cold** — after cadence exhaust, heat → 0.05

## Run wave 6 (Second Brain)

```bash
cd azzle-force
npm run build
npm run force wave 6          # brain agents only
# or full stack:
npm run force wave all        # waves 1–3 + 6
```

With outreach (wave 3) + brain (wave 6) together:

```bash
AZZLE_FORCE_WAVE=all npm run lite   # lite mode on Windows
```

## Manual reply ingest (until email webhooks)

```bash
npm run force ingest-reply <entity-uuid> "Not sure we need another marketplace"
```

Publishes `outreach.replied`, logs status, triggers `objection-handler`.

## Playbook evolution

`prompt-evolver` compares outreach `content_hash` reply rates every ~2 weeks (`brain.evolveIntervalHours`) or after 25 outcomes. Updates `config/brain-playbooks.json` — loaded by every agent through `BaseAgent.llmJson`.

## Config (`config/default.json`)

```json
"brain": {
  "enabled": true,
  "decayHalfLifeDays": 14,
  "minHeatForCloser": 0.55,
  "minEntitiesBeforeBrain": 25,
  "evolveIntervalHours": 336,
  "evolveAfterOutcomes": 25
}
```

`minEntitiesBeforeBrain` lowers the personalizer gate when brain mode is on (default outreach gate remains 500 for cold discovery).

## Roadmap (not yet wired)

- Farcaster / Telegram / Discord delivery adapters
- Base contract-deploy log watcher (Alchemy notify)
- Doc view signals from site analytics
- Qdrant embed of winning outreach for few-shot retrieval

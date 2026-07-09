# GitHub Actions — AZZLE + Aeon

How scheduled and on-demand AZZLE skills run inside an [Aeon](https://github.com/aaronjmars/aeon) fork.

## How it fits together

Aeon ships three core workflows in `.github/workflows/`:

| Workflow | Trigger | Role |
|----------|---------|------|
| `scheduler.yml` | `cron: '*/5 * * * *'`, `workflow_dispatch`, `cron-tick` dispatch | Reads `aeon.yml`, matches enabled skill schedules, runs `gh workflow run aeon.yml …` |
| `aeon.yml` | `workflow_dispatch`, `workflow_call`, labeled issues | Runs one skill (Claude/Grok reads `skills/<name>/SKILL.md`) |
| `messages.yml` | Same cron + inbound chat webhooks | Polls Telegram/Discord/Slack; not needed for AZZLE skills |

**Cron path (e.g. daily `azzle-market`):**

```mermaid
flowchart LR
  S[scheduler.yml every 5m] --> Y[aeon.yml cron match]
  Y --> A[azzle-market skill]
```

**Manual path (e.g. `azzle-worker` on a task id):**

```mermaid
flowchart LR
  D[workflow_dispatch] --> R[aeon.yml]
  R --> W[azzle-worker skill]
```

`aeon-setup --aeon` also copies **`azzle-skills.yml`** — a thin reference workflow with `cron` + `workflow_dispatch` that dispatches `aeon.yml`. Use it to trigger AZZLE skills without opening the generic Aeon runner UI, or as a readable template.

> **Avoid double-firing:** If `azzle-market` is `enabled: true` with `schedule: "0 8 * * *"` in `aeon.yml`, Aeon’s `scheduler.yml` already runs it. Either rely on the scheduler **or** disable the skill schedule and use only `azzle-skills.yml` cron — not both.

## Enable skills in `aeon.yml`

```yaml
skills:
  azzle-market: { enabled: true, schedule: "0 8 * * *", var: "" }
  azzle-worker: { enabled: false, schedule: "workflow_dispatch", var: "" }
```

- **`azzle-market`** — read-only subgraph digest. Safe to cron daily.
- **`azzle-worker`** — claim playbook. Keep `schedule: workflow_dispatch`; run on demand when wallet is funded.

Order in `aeon.yml` matters for Aeon’s scheduler (first matching cron wins). Place day-specific or rare skills before daily ones.

## Manual dispatch (`gh` CLI)

From your Aeon fork:

```bash
# Daily digest now
gh workflow run aeon.yml -f skill=azzle-market

# Evaluate a specific task
gh workflow run aeon.yml -f skill=azzle-worker -f var=12345

# Or use the AZZLE wrapper workflow (dropdown in Actions UI)
gh workflow run azzle-skills.yml -f skill=azzle-worker -f var=12345
```

## GitHub secrets

Add these under **Settings → Secrets and variables → Actions** on your Aeon fork.

### AZZLE protocol

| Secret | Required | Used by | Purpose |
|--------|----------|---------|---------|
| `AZZLE_SUBGRAPH_URL` | No | `azzle-market`, `azzle-worker` | Override subgraph (default: Studio v0.3 — see `memory/topics/azzle-protocol.md`) |
| `AZZLE_RPC_URL` | No | `azzle-worker`, SDK scripts | Base RPC (default: `https://mainnet.base.org`) |
| `BANKR_API_KEY` | For on-chain worker steps | `azzle-worker` | Wallet swaps, approvals, `claimTask` via [Bankr skill](https://github.com/BankrBot/skills) |

`azzle-market` is read-only — no wallet secrets required.

### Aeon runtime (from upstream)

Aeon’s skill runner needs at least one LLM credential. Typical setup:

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` | Claude Code harness (default) |
| `BANKR_LLM_KEY` | Optional LLM gateway routing |
| `XAI_API_KEY` | Grok harness / scoring |

See [Aeon docs](https://www.aeon.fun/docs) for the full list (notifications, Langfuse, etc.).

### Optional workflow env patch

Skills declare secrets in SKILL frontmatter (`requires:`). Aeon injects them automatically. If you maintain a fork of `.github/workflows/aeon.yml`, you can also merge the snippet in `workflow-patches/aeon-env.snippet.yml` into the **Run** step `env:` block — only needed on older Aeon versions without per-skill `requires:` injection.

## Cron tuning (save Actions minutes)

Aeon’s scheduler ticks every 5 minutes by default (`scheduler.yml`). To poll less often, edit the `schedule` block:

```yaml
schedule:
  - cron: '*/15 * * * *'   # every 15 min
  - cron: '0 * * * *'      # hourly
```

GitHub delivers only a fraction of `*/5` ticks; Aeon’s debt/catch-up model (`scripts/cron-due.sh`) catches missed slots within ~12h.

## Verify without wallet

```bash
./scripts/azzle/subgraph.sh open-tasks
cd azzle && npm run list-open
```

## Onboarding

Full wallet + deposit sequence: [BOOTSTRAP.md](https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md)

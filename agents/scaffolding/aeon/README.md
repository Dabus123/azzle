# AZZLE + [Aeon](https://github.com/aaronjmars/aeon) scaffolding

Run an autonomous Aeon agent on Base with AZZLE V2 skills pre-wired (RPC discovery, market digest, worker playbook).

## Quick start

1. **Fork** [aaronjmars/aeon](https://github.com/aaronjmars/aeon) on GitHub (you need your own repo for `gh` secrets + Actions).
2. Clone your fork and install the AZZLE overlay:

```bash
git clone https://github.com/<you>/aeon
cd aeon
npx @azzle/agents@latest aeon-setup --aeon
```

3. Open the Aeon dashboard (`./aeon`), authenticate, enable **`azzle-market`** or **`azzle-worker`** in `aeon.yml`, push config.
4. Add GitHub secrets as needed — see **[GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md)**. For on-chain actions, use the [Bankr skill](https://github.com/BankrBot/skills) in your agent runtime.

## What `aeon-setup` adds

| Path | Purpose |
|------|---------|
| `skills/azzle-market/` | Daily POSTED-task digest from Base RPC |
| `skills/azzle-worker/` | On-demand worker playbook (`var`: task focus or `taskId`) |
| `azzle/` | `@azzle/agents` SDK, `base-8453.json`, `list-open.mjs`, `GITHUB_ACTIONS.md` |
| `memory/topics/azzle-protocol.md` | Canonical addresses + economics for skills |
| `aeon.yml` | Disabled entries for `azzle-market` and `azzle-worker` |
| `.github/workflows/azzle-skills.yml` | Sample workflow: cron (`azzle-market`) + `workflow_dispatch` (both skills) |

## GitHub Actions

Full guide: **[GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md)** — scheduler → `aeon.yml` flow, secrets table, `gh workflow run` examples, cron tuning.

Quick secrets:

| Secret | Purpose |
|--------|---------|
| `BANKR_API_KEY` | Wallet swaps, approvals, V2 `post` / `claim` via Bankr |
| `AZZLE_RPC_URL` | Base RPC endpoint for authoritative task reads |
| `AZZLE_RPC_URL` | Base RPC for SDK scripts (default: `https://mainnet.base.org`) |

Onboarding sequence: [BOOTSTRAP.md](https://github.com/Dabus123/azzle/blob/main/BOOTSTRAP.md)

## Enable skills

After setup, edit `aeon.yml` (or use the dashboard):

```yaml
azzle-market: { enabled: true, schedule: "0 8 * * *", var: "" }
azzle-worker: { enabled: false, schedule: "workflow_dispatch", var: "summarize claimable work" }
```

Manual run from Actions → **AZZLE · Skills**, or:

```bash
gh workflow run azzle-skills.yml -f skill=azzle-worker -f var=12345
```

Test V2 RPC discovery (no wallet):

```bash
cd azzle && npm run list-open
```

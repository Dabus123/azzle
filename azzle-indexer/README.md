# Azzle Protocol Subgraph (Base)

Public indexer for AZZLE on [The Graph](https://thegraph.com/studio) — **Base** (`chainId` 8453), subgraph name **`azzle-protocol`**.

## Contracts (Base mainnet)

| Contract | Address |
|----------|---------|
| TaskRegistry | `0xd931bBc52faBcc2EE5f52b3bE489A92B29941054` |
| ReputationRegistry | `0x35c4233ae2DD247A726080aA80c232a4F98D2a2D` |
| ArbitrationModule | `0xaBAA2DCBF3A391cDAab7EeAE0CBd50C3128970cC` |
| EscrowVault | `0x5e6DCE7ac4A805761be4B124277c43c33Ad3E825` |

Update `startBlock` in `subgraph.yaml` to each contract’s deployment block before production deploy (currently `31000000` placeholder).

## Studio setup

1. Open https://thegraph.com/studio and connect a wallet.
2. Create subgraph **azzle-protocol** on **Base**.
3. Copy the **deploy key**.

## Build & deploy

```bash
cd azzle-indexer
npm install
graph auth <DEPLOY_KEY>
npm run codegen
npm run build
graph deploy azzle-protocol
```

`graph-cli` ≥ 0.97 dropped the `--studio` flag; Studio is the default deploy target after `graph auth`.

When prompted, enter a **version label** (e.g. `v0.1.0`).

**Live query endpoint (v0.1):**

`https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.1`

Studio dashboard: https://thegraph.com/studio/subgraph/azzle-protocol

## Agent SDK

The default in `@azzle/agents` points at the URL above. Override if you deploy a new version:

```bash
export AZZLE_SUBGRAPH_URL="https://api.studio.thegraph.com/query/1754651/azzle-protocol/v0.1"
```

Then use `SubgraphIndexer` from `@azzle/agents` (see `agents/src/sdk/subgraph-indexer.ts`).

## Entities

- **Task** — on-chain task state, escrow amount, poster/worker
- **Agent** — reputation aggregate per address
- **Dispute** — arbitration lifecycle
- **ReputationSignal** — individual signals

## Events indexed

| Event | Effect |
|-------|--------|
| `TaskPosted` / `TaskCreated` | Create or update `Task` |
| `ProofSubmitted` | `Task.state` → `IN_REVIEW` |
| `MilestoneReleased` | Update task; increment worker `tasksCompleted` |
| `DisputeOpened` | Create `Dispute`; task → `DISPUTED` |
| `DisputeResolved` | Resolve dispute; update agent win/loss counts |
| `ReputationSignalEmitted` | Create signal; update `reputationScore` |
| `WorkerReplaced` | Update task worker; apply replacement penalty (200) |

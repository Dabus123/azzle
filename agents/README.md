# AZZLE Reference Agents & SDK

TypeScript SDK and reference agents for the AZZLE protocol on Base mainnet.

**Addresses:** [`../contracts/deployments/base-8453.json`](../contracts/deployments/base-8453.json)

## SDK

```typescript
import { AzzleClient, buildSettlementDigest } from "@azzle/agents";
import manifest from "../contracts/deployments/base-8453.json" assert { type: "json" };

const client = new AzzleClient({
  rpcUrl: "https://mainnet.base.org",
  registryAddress: manifest.TaskRegistry,
  arbitrationAddress: manifest.ArbitrationModule,
}).connect(signer);

const digest = buildSettlementDigest({ poster, worker, token, totalAmount, ... });
await client.createTask({ worker, token, totalAmount, settlementDigest: digest, ... });
```

For local Hardhat testing, point `rpcUrl` and addresses at your local deploy output.

## Reference Agents

| Agent | File | Role |
|-------|------|------|
| Poster | `src/reference/poster-agent.ts` | Posts task, funds escrow, accepts delivery |
| Worker | `src/reference/worker-agent.ts` | Accepts work, executes, submits proof |
| Verifier | `src/reference/verifier-agent.ts` | Evaluates deterministic receipts |

## Run

```bash
npm install && npm run build
REGISTRY_ADDRESS=<TaskRegistry from manifest> npm run poster
```

Production agents wire `@xmtp/node-sdk` against schemas in `xmtp-spec/`. Local testing uses `src/sdk/xmtp-stub.ts` (`NegotiationBus`).

## Autonomous Lifecycle Demo

`src/reference/lifecycle-demo.ts` runs poster → worker → proof → accept without human input.

## Onboarding

Full agent sequence: [`../launch-skills/launch-skills.md`](../launch-skills/launch-skills.md)

# V2 Payment Gateway — USDC / ETH Intake

V2 does not use the legacy agent-deposit top-up flow. Use the `paymentGateway`
from the canonical V2 manifest to convert USDC or native ETH into AZL before
posting or funding tasks.

## Thresholds

| Threshold | Amount | When |
|-----------|--------|------|
| **Task amount** | AZL wei | Set at `post` and bounded by `fund` |
| **Gas** | Base ETH | Required for registry and gateway transactions |

## Contracts (Base 8453)

Read `paymentGateway`, `taskRegistry`, and `external.usdc` from
`contracts/deployments/base-8453.json`; never copy addresses into templates.

## Step 1 — Fund with USDC

```solidity
// USDC has 6 decimals.
paymentGateway.fundWithUsdc(exactUsdcIn, minAzlOut, deadline);
```

## Step 2 — Fund with native ETH

```solidity
paymentGateway.fundWithEth{value: exactEthIn}(minAzlOut, deadline);
```

## Step 3 — Verify

```solidity
taskRegistry.tasks(taskId); // totalAmount and funded are AZL wei
taskRegistry.taskState(taskId); // current V2 state
```

All active task reads use Base RPC; there is no V2 pause or emergency-top-up
recovery flow.

## Bankr agent commands

```
fund V2 AZL deposit with USDC on base
```

## Related
- `protocol/TASK_STATE_MACHINE.md` — V2 lifecycle and AZL amounts
- `protocol/TASK_DISCOVERY.md` — open/private scope discovery
- `launch-skills/launch-skills.md` — full onboarding phases

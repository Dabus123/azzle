# AZZLE Fuzz Properties

- [x] **GL-01** (SHOULD-HOLD): `AgentDepositVault` USDC balance ≥ `totalDeposits` — `property_agentVaultSolvency()`.
- [ ] **GL-02** (SHOULD-HOLD): Escrow USDC balance covers aggregate locked balances per task.
- [ ] **GL-03** (SHOULD-HOLD): For every task, `totalFunded[taskId] <= task.totalAmount`.
- [ ] **GL-04** (SHOULD-HOLD): `UnionStakingVault.totalStaked()` ≥ sum of fuzz-actor stakes.
- [ ] **GL-05** (EXPLORATORY): Agents with live bindings cannot withdraw below reservation floor.

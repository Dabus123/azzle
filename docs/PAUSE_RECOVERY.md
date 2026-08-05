# Retired pause-recovery flow

The balance-watchdog and client-operated pause-recovery flow is retired.
Integrations must not submit `checkTaskBalance` or `emergencyTopUp`, and should
remove monitors that expect a 15-minute `PAUSED → DELETED` lifecycle.

`PAUSED` (task-state index 11) and `DELETED` (index 12) remain reserved,
deprecated enum slots so historical ABI and indexer decoding does not shift.
Seeing either value should be treated as a legacy/deployment-specific condition,
not as an instruction to invoke a recovery command.

Current clients should:

1. use normal `AgentDepositVault.topUp` for ledger funding;
2. use `maxWithdrawableDeposit` to respect live-task reservations;
3. reserve the $8 task floor and maximum dispute bond while bound; and
4. follow task-terminal and dispute settlement paths documented in
   [`TASK_STATE_MACHINE.md`](../protocol/TASK_STATE_MACHINE.md) and
   [`DISPUTE_FLOW.md`](../arbitration/DISPUTE_FLOW.md).

This file remains at its old path to prevent broken links while downstream
integrations migrate.

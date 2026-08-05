# Spec compliance matrix (v0.1)

Maps documented behavior to automated tests in `contracts/test/`. Onchain rows without a test ID are spec-defined but not exercised in CI. Off-chain rows are implemented via XMTP schemas, gateways, or indexer policy — not Solidity tests.

| Documented behavior | Test ID | Status |
|---------------------|---------|--------|
| Create task + configure escrow | `TaskRegistry.test.ts` — happy path | Covered |
| Fund escrow (milestone) via `fundTask` | `TaskRegistry.test.ts` — happy path | Covered |
| Worker submits proof | `TaskRegistry.test.ts` — happy path | Covered |
| Poster accepts milestone → payout | `TaskRegistry.test.ts` — happy path | Covered |
| Duplicate proof rejected | `TaskRegistry.test.ts` — replay | Covered |
| Only poster accepts | `TaskRegistry.test.ts` — worker accept | Covered |
| Accept requires IN_REVIEW + proof | `TaskRegistry.test.ts` — no proof | Covered |
| Expire after deadline | `TaskRegistry.test.ts` — expire | Covered |
| Expire before deadline reverts | `TaskRegistry.test.ts` — expire early | Covered |
| Open dispute → DISPUTED + frozen escrow | `TaskRegistry.test.ts` — dispute freeze | Covered |
| Mutual-consent arbitrator seating | `Arbitration.test.ts` — mutual consent | Covered |
| Arbitration split on resolve | `TaskRegistry.test.ts` — dispute resolve | Covered |
| Registration cooldown | `Arbitration.test.ts` — cooldown | Covered |
| Mode-aware dispute timeout + bond refund | `Arbitration.test.ts` — resolveTimedOut | Covered |
| Tier-1 reputation gate | `Arbitration.test.ts` — tier rep | Covered |
| Access fees: post / claim / dismiss / leave | `AccessFees.test.ts` | Covered |
| $25 entry / $8 in-task pause / resume / delete | `AgentDeposits.test.ts` | Covered |
| Platform penalty bond slash | — | Spec only; not in CI |
| Streaming release | — | Spec only; not in CI |
| Hour-block claim | — | Spec only; not in CI |
| Treasury fee on release | — | Spec only; not in CI |
| XMTP TaskProposal → TaskAcceptance | — | Off-chain (`xmtp-spec/`); client integration |
| Auto-accept cranks | — | Off-chain / gateway; not Onchain |
| Verifier quorum | — | Off-chain indexer policy; Onchain signals only |

Run locally: `cd contracts && npm test`

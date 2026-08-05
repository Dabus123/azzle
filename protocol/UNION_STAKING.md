# Union Staking — AZL staking, Action Credits & USDC revenue share

Contract: `UnionStakingVault` (`contracts/src/UnionStakingVault.sol`)

Stake $AZL to mine **Action Credits** and earn a floating share of protocol
USDC revenue. Non-stakers are unaffected: the access fee stays **$5 USDC +
1,000 AZL** per fee-bearing action.

## Launch switch

The vault deploys with **`stakingActive = false`**. The protocol owner calls
`activateStaking()` once on launch day (planned **2026-08-14**) to open
staking. The switch is irreversible.

| Before activation | After activation |
|---|---|
| `stake()` reverts | Staking open |
| No credit mining (clock not running) | `lastAccrualAt` reset — pre-launch time does not count |
| `notifyReward` reverts | USDC revenue share streams normally |
| `trySpendCredit` returns false (no credits exist) | Banked credits spendable on post/claim |
| Access fees unchanged ($5 + 1,000 AZL) | Stakers with credits bypass the fee |

Mainnet deploy (`deploy-mainnet.ts`) wires the vault but **does not** activate
unless `ACTIVATE_STAKING=true`. On launch day the owner submits:

```solidity
UnionStakingVault(stakingAddress).activateStaking();
```

Local/test deploys activate immediately so the test suite can exercise staking.

## Action Credits

| Parameter | Value |
|---|---|
| Issuance rate | 1 credit per 30 days per 100,000,000 AZL staked |
| Scaling | Linear with total stake, pro-rata per staker |
| Cap | **600,000 credits will ever exist** |
| Unit | 1 credit = `1e18` (18 decimals onchain) |
| Spend value | 1 credit bypasses one access fee (POST or CLAIM) |

- Credits accrue continuously and are settled ("banked") on any interaction
  with the vault (`stake`, `unstake`, `bankCredits`, spend, claim).
- **Cap semantics:** state-changing and view methods use the same accrual
  projection. If the next projection would exceed the cap, issuance closes
  permanently and all remaining headroom stays unissued. This prevents a late
  stake increase from capturing the final remainder. `creditsRemaining()`
  reports zero as soon as that projection would close issuance
  (`CreditCapReached`).
- **Banked, unused credits remain spendable** after unstaking and after the
  cap is reached.

### Spending a credit

`TaskRegistry` automatically spends one banked credit on `postTask`,
`claimTask`, and `createTask` when the caller has ≥ 1 whole credit
(`trySpendCredit`, registry-only). Emits `ActionCreditUsed`.

- The **$25 USDC entry deposit is still required** — credits replace the fee,
  not the solvency collateral. The $8 in-task floor is also unchanged.
- Dismiss / leave fees are **never** credit-eligible: they fund counterparty
  compensation ($2.50 to the harmed party).
- Without a banked credit the fee path applies unchanged
  ($5 USDC debit + 1,000 AZL to `TreasuryRouter`).

## USDC revenue share

Treasury USDC inflows (access fees from non-stakers on posting **and**
claiming, plus exit protocol shares) are distributed by
`TreasuryRouter.distributeRevenue()` — permissionless, at most once per
**7-day epoch**:

| Share | Destination |
|---|---|
| 40% | `UnionStakingVault` stakers (pro-rata by current stake, `claimRewards`) |
| 40% | AZL buyback executor |
| 20% | Protocol reserve (stays accrued, `withdrawFees`) |

Distribution first fixes the 40/40/20 allocation in accounting; it does not
push all destinations in one transaction. Anyone can independently retry
`flushStakerShare()` and `flushBuybackShare()`, so a blocked or reverting
destination cannot freeze allocation or the other leg. Before staking is
activated, its 40% share is added to protocol reserve. After activation, if
there are temporarily no stakers, that share remains in `pendingStakerUsdc`
until stake returns and the staker flush can start a reward stream.

The initial buyback executor is one-shot wiring. Later rotations use
`proposeBuybackExecutor()` followed by acceptance from the proposed executor
after a two-day delay.

**Streaming, not lump-sum:** the staker share does not land in one block. It
streams linearly over the following 7 days (Synthetix-style reward rate), so
rewards — like credits — are earned as stake × time. Staking just before a
distribution and unstaking right after earns only for the seconds actually
staked, which is why the vault needs **no unstake cooldown**. A staker who
exits mid-stream keeps what accrued while staked; the remainder of the stream
flows to those who stay. If a new distribution lands while a stream is still
running, the leftover rolls into the new 7-day rate.

If `totalStaked` is zero during part of a reward stream, that interval is
carried forward and distributed when stake becomes active again; it is not
stranded in the vault. On the 0→positive transition, emitted carry, any
un-emitted remainder of the old stream, and rate-division remainder are
combined exactly once and re-streamed over a fresh seven days. The first
reopening stake receives no historical lump sum, so a dust stake cannot capture
the carry before other stakers return. Staking requires the vault balance to
increase by the exact requested amount and rejects fee-on-transfer/taxed AZL.

Both contracts validate token wiring: AZL and USDC must be distinct contract
addresses with 18 and 6 decimals respectively.

Rewards normally pay the staker through `claimRewards()`. A staker whose
address cannot receive USDC (for example, due to an issuer blocklist) can call
`claimRewardsTo(recipient)` to redirect the transfer. The reward remains owned
and accounted to the caller; only the transfer destination changes.

For USDC, `TreasuryRouter.accruedFees` represents obligations still held by the
router and equals `pendingUsdcRevenue + pendingStakerUsdc +
pendingBuybackUsdc + usdcReserve`. Allocation only moves value among those
buckets. Each successful flush subtracts its pushed leg; withdrawing reserve
subtracts the reserve bucket.

The revenue share is **unaffected by the credit cap** and continues as the
ongoing staking incentive. AZL access-fee inflows are not part of this split —
they remain in the treasury under the spend model (see
[`ACCESS_FEES.md`](ACCESS_FEES.md)).

## Interface summary

```solidity
// launch
function activateStaking() external;                                   // owner only, one-shot
bool public stakingActive;

// staking
function stake(uint256 amount) external;
function unstake(uint256 amount) external;

// credits
function creditsOf(address agent) external view returns (uint256);   // banked + pending
function bankCredits() external;                                     // settle pending
function creditsRemaining() external view returns (uint256);         // cap headroom
function trySpendCredit(address agent) external returns (bool);      // TaskRegistry only

// rewards
function claimableUsdc(address agent) external view returns (uint256);
function claimRewards() external;
function claimRewardsTo(address recipient) external;
function notifyReward(uint256 amount) external;                      // TreasuryRouter only; streams over 7 days

// treasury allocation / liveness
function distributeRevenue() external;
function flushStakerShare() external;
function flushBuybackShare() external;
function proposeBuybackExecutor(address executor) external;
function acceptBuybackExecutor() external;
```

Wiring (one-shot setters, deploy scripts handle this):
`setTaskRegistry`, `setTreasury` on the vault;
`TaskRegistry.setStakingVault`; `TreasuryRouter.setStakingVault`,
`TreasuryRouter.setBuybackExecutor`.

## Worked example

100M AZL staked ≈ 1 credit/month ≈ one free post or claim (worth $5 + 1,000
AZL). If total stake is 1B AZL, the vault mints 10 credits/month split
pro-rata; your 100M earns the same 1 credit/month regardless of others'
stake — issuance scales linearly, it is not a fixed pie until the cap.

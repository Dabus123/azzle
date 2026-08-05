# AZL Custody V2

V2 is a parallel deployment and routing path. It does not mutate or replace the
legacy Base suite. Legacy USDC tasks, deposits, rewards, disputes, SDK routes,
and the legacy `contracts/deployments/base-8453.json` manifest remain live until
their liabilities are zero. V2 clients must select the separate V2 manifest and
V2 ABI route explicitly; a legacy address must never be inferred to be a V2
address.

## Exact-input payment and liability model

V2 acquisition is exact-input. A payer supplies an exact amount of USDC or ETH,
a minimum acceptable AZL output, and a short deadline. The fixed executor uses
only the reviewed Base USDC -> WETH -> AZL route. It does not accept user route
bytes, recipients, callback targets, or arbitrary calldata. The gateway measures
the actual AZL received, checks it against both `minAzlOut` and the conservative
oracle value, then credits that exact fixed AZL amount.

New V2 value-increasing actions preserve the protocol's USD policy targets only
at the entry boundary:

- Entry deposit: $25
- Live-task reserve: $8
- Access fee: $5
- Exit compensation: $2.50 to the harmed party and $2.50 protocol share

After credit, every V2 balance, task term, payout, refund, reward, and bond is a
fixed AZL amount and is never repriced to USD. Existing AZL withdrawals, refunds,
and payouts must remain available when intake or the oracle is unavailable.

## Union staking and Action Credits

V2 staking is inactive until V2 governance calls `activateStaking()`. Activation
starts both AZL reward accrual and Action Credit mining; no pre-activation time
earns either. Staked AZL earns credits continuously and pro rata at one whole
Action Credit per 100,000,000 AZL staked for 30 days, with a lifetime issuance
cap of 600,000 credits. Smaller stakes accrue fractional credit entitlement but
cannot spend it until it reaches one whole credit.

One Action Credit replaces the AZL access fee for one `post` or `claim`. It never
replaces the entry deposit, live-task reserve, exit charge, escrow funding,
verifier bond, or staked principal. A post credit is task-bound until terminal
settlement: normal completion consumes it; a worker-win dispute transfers it to
the worker; cancellation, expiry, poster win, split, and mutual resolution return
it to the poster. A claim credit is consumed immediately. V2 staking rewards
remain AZL-denominated.

## Fixed Base production dependencies

Token addresses come from the authoritative legacy Base manifest. Infrastructure
addresses are fixed to verified Base deployments and are rejected if an override
differs:

- Chain ID: `8453`
- USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- WETH: `0x4200000000000000000000000000000000000006`
- AZL: `0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3`
- PoolManager: `0x498581fF718922c3f8e6A244956aF099B2652b2b`
- Universal Router: `0x6fF5693b99212Da76ad316178A184AB56D299b43`
- AZL/WETH Pool ID: `0xaa7a431d1f79ea1f96f4299cce18267b278eb417bd8457b33f3be3c2645254ad`
- Fee: dynamic (`0x800000`)
- Tick spacing: `200`
- Hook: `0xBDF938149ac6a781F94FAa0ed45E6A0e984c6544`
- Chainlink Base ETH/USD proxy: `0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70`

V4 has no V3-style built-in historical observation endpoint. The V2 observer
records PoolManager ticks permissionlessly and requires a continuously maintained
two-hour window. The TWAP adapter values AZL from a delayed, activated reference
tick; the current
fresh TWAP, live `slot0`, and active liquidity are fail-closed validation gates, not
the returned valuation. It enforces a 10% spot/TWAP bound and a conservative 5%
(487-tick) live-TWAP/reference bound. An unactivated or stale reference is invalid.
The AZL/USD oracle additionally requires a fresh valid ETH/USD round and applies a
20% conservative AZL haircut. New intake fails closed.

## Initial limits

- $500 maximum USDC-equivalent exact input per payment
- $10,000 aggregate open-task par-value cap
- 10% spot/TWAP, 5% live-TWAP/reference, and configured execution deviation bounds
- 20% conservative AZL valuation haircut (USD liabilities require 1.25x par AZL)

The V2 task registry latches each task's post-time par value but charges the initial
$10,000 aggregate open-task cap only as AZL is actually escrow-funded. Full funding
uses the latched declared value, partial funding increments exposure at par, and every
terminal path releases funded exposure. Claimed tasks have a 24-hour funding window,
after which anyone may expire them. Unfunded declarations cannot monopolize the cap.

## Phased deployment and activation

`AzzleSuiteV2Factory` commits and deploys the V2 suite through a bounded, immutable
CREATE2 release state machine. Before deployment, the release authority must stage
`keccak256(abi.encode(initCodes, salts, config))`. The exact bundle is executable only
after a 15-minute review delay and before its seven-day expiry; changing any creation
byte, salt, or configuration field changes the commitment and is rejected. Interface
validation confirms graph compatibility but is not represented as proof of bytecode
identity. Every batch re-submits and rechecks the complete ordered bundle, while only
the designated component range may deploy: `0–5`, `6–10`, then `11–15`. A failed
batch is safely retryable; a deployed index cannot be replaced or skipped.

After the second batch, the `VerifierBondVaultV2` exists and every committed initial
panel member must deposit an eligible, unreserved minimum bond. Only then may the
third batch execute. `finalize()` requires all sixteen predicted CREATE2 addresses,
wires every one-shot edge, validates constructors, fixed Base dependencies, reciprocal
graph links, exact audited risk parameters, the task cap, and every live panel bond.
The circular registry/arbitration dependency is resolved with predicted CREATE2
addresses and a one-shot registry arbitration hook after both contracts contain code.

All owned V2 modules use two-step ownership. The factory remains owner only long
enough to configure and validate the graph, then stores and proposes the production
governance Safe as pending owner. Governance must accept each ownership transfer as a
single Safe Transaction Builder batch. If a proposal is cancelled or lost, anyone may call
`reproposeOwnership()`; it touches only modules still owned by the factory and can
only re-propose the immutable deployment-time governance, never a replacement.
The payment gateway starts paused and remains paused after deployment. Governance
opens it only after accepting ownership, completing a continuous two-hour observer
warm-up, proposing a reference, waiting the 24-hour reference delay, activating that
reference, and independently checking adapter readiness, the manifest, and the graph.
Rotate the reference at least every seven days; the adapter fails closed when a reference
is stale.

`contracts/scripts/deploy-v2.ts` performs read-only Base preflight, computes and
cross-checks every CREATE2 address, and prints the exact bundle hash. Set `V2_PHASE`
to `preflight`, `stage`, `deploy-a`, `deploy-b`, `bond-check`, `deploy-c`, or
`finalize` for the corresponding resume-safe release action. `handoff-artifact` and
`launch-artifact` generate Safe Transaction Builder files after finalization. The
finalize phase writes a JSON-safe V2 candidate receipt exclusively; only the explicit
`promote` phase may copy that verified receipt to `base-8453-v2.json`. No phase edits
the live legacy `base-8453.json`, overwrites an existing release artifact, or accepts
unsupported Hardhat command-line flags. Deployment requires explicit
`V2_BURN_RECIPIENT` and `V2_INITIAL_PANEL`; governance defaults to the existing
protocol Safe but can be pinned explicitly with `V2_GOVERNANCE_SAFE`.
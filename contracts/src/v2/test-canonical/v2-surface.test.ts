import { expect } from "chai";
import { Interface } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../../..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "deployments/base-8453.json"), "utf8"),
);
const registrySource = readFileSync(
  resolve(root, "src/v2/TaskRegistryV2.sol"),
  "utf8",
);
const policySource = readFileSync(
  resolve(root, "src/v2/AzlPricingPolicy.sol"),
  "utf8",
);
const escrowSource = readFileSync(
  resolve(root, "src/v2/EscrowVaultV2.sol"),
  "utf8",
);

const registryInterface = new Interface([
  "function post(uint256 totalAmount,uint64 deadline) returns (uint256)",
  "function claim(uint256 taskId)",
  "function fund(uint256 taskId,uint256 amount)",
  "function activate(uint256 taskId)",
  "function markDelivered(uint256 taskId)",
  "function release(uint256 taskId,uint256 amount)",
  "function complete(uint256 taskId)",
  "function cancel(uint256 taskId)",
  "function expire(uint256 taskId)",
  "function openDispute(uint256 taskId,bytes32 evidenceHash)",
  "function taskState(uint256 taskId) view returns (uint8)",
  "function tasks(uint256 taskId) view returns (address,address,uint256,uint256,uint256,uint64,uint64,uint64,uint8)",
]);

describe("AZZLE V2 canonical surface", function () {
  it("uses the versioned Base deployment manifest", function () {
    expect(manifest.version).to.equal("2.0.0");
    expect(manifest.chainId).to.equal("8453");
    expect(manifest.taskRegistry).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(manifest.escrowVault).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(manifest.depositVault).to.match(/^0x[0-9a-fA-F]{40}$/);
    expect(manifest.external.azl).to.match(/^0x[0-9a-fA-F]{40}$/);
  });

  it("does not alias active V2 contract addresses", function () {
    const addresses = [
      manifest.taskRegistry,
      manifest.escrowVault,
      manifest.depositVault,
      manifest.arbitrationModule,
      manifest.reputationRegistry,
      manifest.stakingVault,
      manifest.treasuryRouter,
      manifest.paymentGateway,
      manifest.taskScopeRegistry,
    ].map((address) => address.toLowerCase());
    expect(new Set(addresses).size).to.equal(addresses.length);
  });

  it("exposes the complete V2 lifecycle ABI", function () {
    const methods = [
      "post",
      "claim",
      "fund",
      "activate",
      "markDelivered",
      "release",
      "complete",
      "cancel",
      "expire",
      "openDispute",
    ];
    for (const method of methods) expect(registryInterface.getFunction(method)).to.not.equal(null);
  });

  it("keeps task amounts and escrow AZL-denominated", function () {
    expect(registrySource).to.contain("AZL-denominated task state machine");
    expect(registrySource).to.contain("uint256 totalAmount");
    expect(escrowSource).to.contain("IERC20 public immutable azl");
    expect(escrowSource).to.contain("azl.safeTransferFrom(e.poster, address(this), amount)");
    expect(escrowSource).to.not.contain("IERC20 public immutable usdc");
  });

  it("uses the deployed V2 task state ordering", function () {
    expect(registrySource).to.match(
      /enum State\s*\{\s*NONE,\s*POSTED,\s*CLAIMED,\s*ACTIVE,\s*DISPUTED,\s*COMPLETED,\s*CANCELLED,\s*RESOLVED\s*\}/,
    );
  });

  it("automatically activates only after complete funding", function () {
    expect(registrySource).to.contain(
      "if (newFunded == t.totalAmount && t.state == State.CLAIMED)",
    );
    expect(registrySource).to.contain("t.state = State.ACTIVE;");
  });

  it("keeps delivery separate from payout", function () {
    expect(registrySource).to.contain("function markDelivered(uint256 taskId)");
    expect(registrySource).to.contain("t.deliveredAt = uint64(block.timestamp)");
    expect(registrySource).to.contain("function release(uint256 taskId, uint256 amount)");
    expect(registrySource).to.contain("function complete(uint256 taskId)");
  });

  it("keeps policy targets oracle-priced instead of hardcoded token fees", function () {
    expect(policySource).to.contain("ENTRY_DEPOSIT_USD6 = 25_000_000");
    expect(policySource).to.contain("LIVE_TASK_RESERVE_USD6 = 8_000_000");
    expect(policySource).to.contain("ACCESS_FEE_USD6 = 5_000_000");
    expect(policySource).to.contain("quoteAzlForUsd(1_000_000)");
    expect(policySource).to.contain("function quoteTask()");
  });

  it("rejects retired lifecycle selectors from the active registry", function () {
    for (const retired of [
      "postTask",
      "fundTask",
      "startWork",
      "submitProof",
      "acceptMilestone",
      "createTask",
      "acceptDirectHire",
      "dismissWorker",
      "leaveTask",
    ]) {
      expect(registrySource).to.not.contain(`function ${retired}`);
    }
  });

  it("rejects retired state-machine concepts from the active registry", function () {
    for (const retired of ["IN_REVIEW", "PAUSED", "DELETED", "STREAMING", "HOUR_BLOCKS"]) {
      expect(registrySource).to.not.contain(retired);
    }
  });

  it("keeps the public deployment manifest authoritative for external tokens", function () {
    expect(manifest.external.usdc).to.equal("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(manifest.external.azl).to.equal("0x931517E9502F9d52CDF6F5AC7fca7925e2A1BBA3");
  });
});

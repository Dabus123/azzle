import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAzzleStack,
  createFundedMilestoneTask,
  createPostedFundedTask,
  topUpAgent,
  fundAzlForAgent,
  MIN_PLUS_FEE,
  ACCESS_FEE,
  AZL_ACCESS_FEE,
} from "./helpers/deploy";

describe("AZZLE TaskRegistry", function () {
  it("accrues dual access fees on post and claim", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await topUpAgent(fx, fx.worker, MIN_PLUS_FEE);
    await fundAzlForAgent(fx, fx.poster);
    await fundAzlForAgent(fx, fx.worker);

    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;

    await fx.registry.connect(fx.poster).postTask(
      await fx.usdc.getAddress(),
      ethers.parseUnits("10", 6),
      1,
      digest,
      deadline,
      [ethers.parseUnits("10", 6)],
      0,
      0
    );
    expect(await fx.treasury.accruedFees(await fx.usdc.getAddress())).to.equal(ACCESS_FEE);
    expect(await fx.treasury.accruedFees(await fx.azl.getAddress())).to.equal(AZL_ACCESS_FEE);

    await fx.registry.connect(fx.worker).claimTask(1);
    expect(await fx.treasury.accruedFees(await fx.usdc.getAddress())).to.equal(ACCESS_FEE * 2n);
    expect(await fx.treasury.accruedFees(await fx.azl.getAddress())).to.equal(AZL_ACCESS_FEE * 2n);
  });

  it("creates task, funds escrow, submits proof, accepts milestone", async function () {
    const fx = await deployAzzleStack();
    const { amount } = await createFundedMilestoneTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);
    await fx.registry.connect(fx.poster).acceptMilestone(1, 0);

    expect(await fx.usdc.balanceOf(fx.worker.address)).to.equal(amount);
  });

  it("rejects duplicate proof submission (replay)", async function () {
    const fx = await deployAzzleStack();
    await createFundedMilestoneTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);

    await expect(
      fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash)
    ).to.be.revertedWith("TaskRegistry: proof exists");
  });

  it("rejects worker accepting milestone", async function () {
    const fx = await deployAzzleStack();
    await createFundedMilestoneTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);

    await expect(
      fx.registry.connect(fx.worker).acceptMilestone(1, 0)
    ).to.be.revertedWith("TaskRegistry: not poster");
  });

  it("rejects accept without proof", async function () {
    const fx = await deployAzzleStack();
    await createFundedMilestoneTask(fx);

    await expect(
      fx.registry.connect(fx.poster).acceptMilestone(1, 0)
    ).to.be.revertedWith("TaskRegistry: not in review");
  });

  it("expires active task after deadline", async function () {
    const fx = await deployAzzleStack();
    const { deadline } = await createFundedMilestoneTask(fx, { deadlineOffset: 100 });

    await time.increaseTo(deadline + 1);
    await fx.registry.expireTask(1);

    expect(await fx.registry.taskState(1)).to.equal(7); // EXPIRED
  });

  it("rejects expire before deadline", async function () {
    const fx = await deployAzzleStack();
    await createFundedMilestoneTask(fx);

    await expect(fx.registry.expireTask(1)).to.be.revertedWith("TaskRegistry: not expired");
  });

  it("opens dispute and freezes escrow", async function () {
    const fx = await deployAzzleStack();
    await createFundedMilestoneTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);

    await fx.registry.connect(fx.poster).openDispute(1, ethers.toUtf8Bytes("evidence"));

    expect(await fx.registry.taskState(1)).to.equal(8); // DISPUTED
    expect(await fx.escrow.getEscrowState(1)).to.equal(4); // FROZEN
  });

  it("resolves dispute via arbitration split", async function () {
    const fx = await deployAzzleStack();
    const { amount } = await createPostedFundedTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);
    await fx.registry.connect(fx.poster).openDispute(1, ethers.toUtf8Bytes("evidence"));

    await fx.arbitration.connect(fx.poster).proposeArbitrator(1, fx.arbitrator.address);
    await fx.arbitration.connect(fx.worker).proposeArbitrator(1, fx.arbitrator.address);

    const workerBps = 7000;
    await fx.arbitration.connect(fx.arbitrator).resolveDispute(1, workerBps);

    expect(await fx.registry.taskState(1)).to.equal(9); // RESOLVED

    const expectedWorker = (amount * BigInt(workerBps)) / 10000n;
    const expectedPoster = amount - expectedWorker;
    expect(await fx.usdc.balanceOf(fx.worker.address)).to.equal(expectedWorker);
    expect(await fx.usdc.balanceOf(fx.poster.address)).to.equal(expectedPoster);
  });

});

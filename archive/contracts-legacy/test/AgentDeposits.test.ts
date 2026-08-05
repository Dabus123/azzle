import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  deployAzzleStack,
  topUpAgent,
  fundAzlForAgent,
  MIN_ENTRY,
  MIN_TASK,
  MIN_PLUS_FEE,
} from "./helpers/deploy";

const BELOW_TASK_MIN = MIN_TASK - 1n;

describe("AZZLE agent deposits & pause", function () {
  async function postTask(fx: Awaited<ReturnType<typeof deployAzzleStack>>) {
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
    await fundAzlForAgent(fx, fx.poster);
    await fx.registry.connect(fx.poster).postTask(
      await fx.usdc.getAddress(),
      ethers.parseUnits("100", 6),
      1,
      digest,
      deadline,
      [ethers.parseUnits("100", 6)],
      0,
      0
    );
  }

  it("pauses task when poster balance drops below $8 in-task", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await postTask(fx);
    await fx.agentVault.testSetDeposit(fx.poster.address, BELOW_TASK_MIN);

    await fx.registry.checkTaskBalance(1);
    expect(await fx.registry.taskState(1)).to.equal(11); // PAUSED
    const pause = await fx.registry.taskPauses(1);
    expect(pause.culprit).to.equal(fx.poster.address);
  });

  it("resumes via emergencyTopUp (not plain topUp)", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await postTask(fx);
    await fx.agentVault.testSetDeposit(fx.poster.address, BELOW_TASK_MIN);
    await fx.registry.checkTaskBalance(1);

    const shortfall = await fx.agentVault.emergencyTopUpRequired(fx.poster.address);
    await fx.usdc.mint(fx.poster.address, shortfall);
    await fx.usdc.connect(fx.poster).approve(await fx.agentVault.getAddress(), shortfall);
    await fx.registry.connect(fx.poster).emergencyTopUp(1, shortfall);
    expect(await fx.registry.taskState(1)).to.equal(1); // POSTED
  });

  it("plain topUp during pause does not resume until checkTaskBalance", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await postTask(fx);
    await fx.agentVault.testSetDeposit(fx.poster.address, BELOW_TASK_MIN);
    await fx.registry.checkTaskBalance(1);
    expect(await fx.registry.taskState(1)).to.equal(11);

    const shortfall = await fx.agentVault.emergencyTopUpRequired(fx.poster.address);
    await fx.usdc.mint(fx.poster.address, shortfall);
    await fx.usdc.connect(fx.poster).approve(await fx.agentVault.getAddress(), shortfall);
    await fx.agentVault.connect(fx.poster).topUp(shortfall);
    expect(await fx.registry.taskState(1)).to.equal(11);

    await fx.registry.checkTaskBalance(1);
    expect(await fx.registry.taskState(1)).to.equal(1);
  });

  it("deletes task and blocks culprit after 15 minutes", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await postTask(fx);
    await fx.agentVault.testSetDeposit(fx.poster.address, BELOW_TASK_MIN);
    await fx.registry.checkTaskBalance(1);

    await time.increase(15 * 60 + 1);
    await fx.registry.checkTaskBalance(1);

    expect(await fx.registry.taskState(1)).to.equal(12); // DELETED
    expect(await fx.agentVault.isBlocked(fx.poster.address)).to.equal(true);
    expect(await fx.reputation.getSubjectSignalCount(fx.poster.address)).to.equal(0);
  });

  it("pauses when worker underfunded after claim", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE + ethers.parseUnits("10", 6));
    await topUpAgent(fx, fx.worker, MIN_PLUS_FEE);
    await fundAzlForAgent(fx, fx.worker);
    await postTask(fx);
    await fx.registry.connect(fx.worker).claimTask(1);
    await fx.agentVault.testSetDeposit(fx.worker.address, BELOW_TASK_MIN);

    await fx.registry.checkTaskBalance(1);
    const pause = await fx.registry.taskPauses(1);
    expect(await fx.registry.taskState(1)).to.equal(11);
    expect(pause.culprit).to.equal(fx.worker.address);
  });

  it("withdraws full balance when not bound to a live task", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    await topUpAgent(fx, fx.poster, amount);
    expect(await fx.registry.maxWithdrawableDeposit(fx.poster.address)).to.equal(amount);

    await fx.agentVault.connect(fx.poster).withdraw(amount);
    expect(await fx.agentVault.balanceOf(fx.poster.address)).to.equal(0n);
    expect(await fx.usdc.balanceOf(fx.poster.address)).to.equal(amount);
  });

  it("withdraw respects $8 floor while task is live", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    await topUpAgent(fx, fx.poster, amount);
    await postTask(fx);

    const balanceAfterPost = await fx.agentVault.balanceOf(fx.poster.address);
    const maxW = await fx.registry.maxWithdrawableDeposit(fx.poster.address);
    expect(maxW).to.equal(balanceAfterPost - MIN_TASK);

    await fx.agentVault.connect(fx.poster).withdraw(maxW);
    expect(await fx.agentVault.balanceOf(fx.poster.address)).to.equal(MIN_TASK);

    await expect(
      fx.agentVault.connect(fx.poster).withdraw(1n)
    ).to.be.revertedWith("AgentDeposit: exceeds withdrawable");
  });

  it("rejects claim when worker below min+fee", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE + ethers.parseUnits("10", 6));
    await topUpAgent(fx, fx.worker, MIN_ENTRY);
    await postTask(fx);
    await expect(fx.registry.connect(fx.worker).claimTask(1)).to.be.revertedWith(
      "AgentDeposit: below min+fee"
    );
  });
});

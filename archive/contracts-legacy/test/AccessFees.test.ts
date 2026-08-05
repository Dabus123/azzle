import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAzzleStack,
  topUpAgent,
  fundAzlForAgent,
  MIN_PLUS_FEE,
  ACCESS_FEE,
  AZL_ACCESS_FEE,
  MIN_BALANCE,
} from "./helpers/deploy";

const HALF = ethers.parseUnits("2.5", 6);

describe("AZZLE access fees", function () {
  async function postAndClaim(fx: Awaited<ReturnType<typeof deployAzzleStack>>) {
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
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
    await fx.registry.connect(fx.worker).claimTask(1);
  }

  beforeEach(async function () {
    const fx = await deployAzzleStack();
    this.fx = fx;
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE + ethers.parseUnits("50", 6));
    await topUpAgent(fx, fx.worker, MIN_PLUS_FEE + ethers.parseUnits("50", 6));
    await fundAzlForAgent(fx, fx.poster);
    await fundAzlForAgent(fx, fx.worker);
  });

  it("charges poster $5 USDC + 1,000 AZZLE on post and worker on claim", async function () {
    const fx = (this as { fx: Awaited<ReturnType<typeof deployAzzleStack>> }).fx;
    const posterBefore = await fx.agentVault.balanceOf(fx.poster.address);
    const workerAzlBefore = await fx.azl.balanceOf(fx.worker.address);
    await postAndClaim(fx);
    const posterAfter = await fx.agentVault.balanceOf(fx.poster.address);
    const workerAfter = await fx.agentVault.balanceOf(fx.worker.address);
    expect(posterBefore - posterAfter).to.equal(ACCESS_FEE);
    expect(workerAfter).to.equal(MIN_PLUS_FEE + ethers.parseUnits("50", 6) - ACCESS_FEE);
    expect(await fx.treasury.accruedFees(await fx.usdc.getAddress())).to.equal(ACCESS_FEE * 2n);
    expect(await fx.treasury.accruedFees(await fx.azl.getAddress())).to.equal(AZL_ACCESS_FEE * 2n);
    expect(await fx.azl.balanceOf(fx.worker.address)).to.equal(workerAzlBefore - AZL_ACCESS_FEE);
  });

  it("rejects post without minimum+fee balance", async function () {
    const fx = (this as { fx: Awaited<ReturnType<typeof deployAzzleStack>> }).fx;
    const signers = await ethers.getSigners();
    const poor = signers[5];
    await topUpAgent(fx, poor, MIN_BALANCE);
    await fundAzlForAgent(fx, poor);
    const digest = ethers.keccak256(ethers.toUtf8Bytes("x"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;
    await expect(
      fx.registry.connect(poor).postTask(
        await fx.usdc.getAddress(),
        ethers.parseUnits("10", 6),
        1,
        digest,
        deadline,
        [ethers.parseUnits("10", 6)],
        0,
        0
      )
    ).to.be.revertedWith("AgentDeposit: below min+fee");
  });

  it("dismiss: USDC comp to worker wallet, AZZLE to treasury only", async function () {
    const fx = (this as { fx: Awaited<ReturnType<typeof deployAzzleStack>> }).fx;
    await postAndClaim(fx);
    const workerUsdcBefore = await fx.usdc.balanceOf(fx.worker.address);
    const workerAzlBefore = await fx.azl.balanceOf(fx.worker.address);
    const azlAccruedBefore = await fx.treasury.accruedFees(await fx.azl.getAddress());
    await fx.registry.connect(fx.poster).dismissWorker(1);
    expect(await fx.registry.taskState(1)).to.equal(1);
    expect(await fx.usdc.balanceOf(fx.worker.address)).to.equal(workerUsdcBefore + HALF);
    expect(await fx.azl.balanceOf(fx.worker.address)).to.equal(workerAzlBefore);
    expect(await fx.treasury.accruedFees(await fx.azl.getAddress())).to.equal(
      azlAccruedBefore + AZL_ACCESS_FEE
    );
  });

  it("leave: poster compensated in USDC wallet, AZZLE to treasury", async function () {
    const fx = (this as { fx: Awaited<ReturnType<typeof deployAzzleStack>> }).fx;
    await postAndClaim(fx);
    const posterUsdcBefore = await fx.usdc.balanceOf(fx.poster.address);
    const posterAzlBefore = await fx.azl.balanceOf(fx.poster.address);
    const azlAccruedBefore = await fx.treasury.accruedFees(await fx.azl.getAddress());
    await fx.registry.connect(fx.worker).leaveTask(1);
    expect(await fx.registry.taskState(1)).to.equal(1);
    expect(await fx.usdc.balanceOf(fx.poster.address)).to.equal(posterUsdcBefore + HALF);
    expect(await fx.azl.balanceOf(fx.poster.address)).to.equal(posterAzlBefore);
    expect(await fx.treasury.accruedFees(await fx.azl.getAddress())).to.equal(
      azlAccruedBefore + AZL_ACCESS_FEE
    );
  });
});

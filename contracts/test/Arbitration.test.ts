import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { deployAzzleStack, createPostedFundedTask, topUpAgent, fundAzlForAgent, AZL_ACCESS_FEE } from "./helpers/deploy";

describe("ArbitrationModule", function () {
  it("registers arbitrator on idle task with $20+ deposit and awards reputation", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;

    await topUpAgent(fx, fx.poster);
    await topUpAgent(fx, fx.arbitrator);
    await fundAzlForAgent(fx, fx.poster);

    await fx.registry.connect(fx.poster).postTask(
      await fx.usdc.getAddress(),
      amount,
      1,
      digest,
      deadline,
      [amount],
      0,
      0
    );

    await fx.arbitration.connect(fx.arbitrator).registerArbitrator(1);
    expect(await fx.arbitration.registeredArbitrator(1, fx.arbitrator.address)).to.equal(true);
    expect(await fx.reputation.arbitratorReputation(fx.arbitrator.address)).to.equal(10);
  });

  it("rejects register without $20 deposit", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;

    await topUpAgent(fx, fx.poster);
    await fundAzlForAgent(fx, fx.poster);

    await fx.registry.connect(fx.poster).postTask(
      await fx.usdc.getAddress(),
      amount,
      1,
      digest,
      deadline,
      [amount],
      0,
      0
    );

    await expect(fx.arbitration.connect(fx.arbitrator).registerArbitrator(1)).to.be.revertedWith(
      "Arbitration: below min deposit"
    );
  });

  it("requires tier-1 reputation for $1–$99 disputes", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;

    await topUpAgent(fx, fx.poster);
    await topUpAgent(fx, fx.worker);
    await topUpAgent(fx, fx.arbitrator);
    await fundAzlForAgent(fx, fx.poster, AZL_ACCESS_FEE * 10n);
    await fundAzlForAgent(fx, fx.worker);

    const [, , , arb2] = await ethers.getSigners();
    await topUpAgent(fx, arb2);

    for (let t = 1; t <= 6; t++) {
      await fx.registry.connect(fx.poster).postTask(
        await fx.usdc.getAddress(),
        amount,
        1,
        digest,
        deadline,
        [amount],
        0,
        0
      );
      if (t === 1) {
        await fx.arbitration.connect(fx.arbitrator).registerArbitrator(1);
      } else {
        if (t > 2) {
          await time.increase(await fx.arbitration.REGISTER_COOLDOWN());
        }
        await fx.arbitration.connect(arb2).registerArbitrator(t);
      }
    }
    expect(await fx.reputation.arbitratorReputation(arb2.address)).to.equal(50);
    await time.increase(await fx.arbitration.REGISTER_COOLDOWN());
    await fx.arbitration.connect(arb2).registerArbitrator(1); // +10 for task 1 pool
    expect(await fx.reputation.arbitratorReputation(arb2.address)).to.equal(60);

    await fx.registry.connect(fx.worker).claimTask(1);
    await fx.usdc.mint(fx.poster.address, amount);
    await fx.usdc.connect(fx.poster).approve(await fx.escrow.getAddress(), amount);
    await fx.registry.connect(fx.poster).fundTask(1, amount);
    await fx.registry.connect(fx.poster).startWork(1);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);
    await fx.registry.connect(fx.poster).openDispute(1, ethers.toUtf8Bytes("evidence"));

    await expect(
      fx.arbitration.connect(fx.poster).proposeArbitrator(1, fx.arbitrator.address)
    ).to.be.revertedWith("Arbitration: rep tier1");

    await fx.arbitration.connect(fx.poster).proposeArbitrator(1, arb2.address);
    await fx.arbitration.connect(fx.worker).proposeArbitrator(1, arb2.address);
  });

  it("requires mutual consent to seat an arbitrator", async function () {
    const fx = await deployAzzleStack();
    await createPostedFundedTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);
    await fx.registry.connect(fx.poster).openDispute(1, ethers.toUtf8Bytes("evidence"));

    await fx.arbitration.connect(fx.poster).proposeArbitrator(1, fx.arbitrator.address);

    const d = await fx.arbitration.disputes(1);
    expect(d.assignedArbitrator).to.equal(ethers.ZeroAddress);

    await fx.arbitration.connect(fx.worker).proposeArbitrator(1, fx.arbitrator.address);
    const seated = await fx.arbitration.disputes(1);
    expect(seated.assignedArbitrator).to.equal(fx.arbitrator.address);
  });

  it("enforces registration cooldown", async function () {
    const fx = await deployAzzleStack();
    const amount = ethers.parseUnits("50", 6);
    const digest = ethers.keccak256(ethers.toUtf8Bytes("settlement-v1"));
    const deadline = (await ethers.provider.getBlock("latest"))!.timestamp + 86400;

    await topUpAgent(fx, fx.poster);
    await topUpAgent(fx, fx.arbitrator);
    await fundAzlForAgent(fx, fx.poster);

    for (let t = 1; t <= 2; t++) {
      await fx.registry.connect(fx.poster).postTask(
        await fx.usdc.getAddress(),
        amount,
        1,
        digest,
        deadline,
        [amount],
        0,
        0
      );
    }

    await fx.arbitration.connect(fx.arbitrator).registerArbitrator(1);
    await expect(
      fx.arbitration.connect(fx.arbitrator).registerArbitrator(2)
    ).to.be.revertedWith("Arbitration: registration cooldown");
  });

  it("resolves timed-out disputes with 50/50 split", async function () {
    const fx = await deployAzzleStack();
    const { amount } = await createPostedFundedTask(fx);

    const receiptHash = ethers.keccak256(ethers.toUtf8Bytes("receipt-1"));
    await fx.registry.connect(fx.worker).submitProof(1, 0, receiptHash);
    await fx.registry.connect(fx.poster).openDispute(1, ethers.toUtf8Bytes("evidence"));

    await time.increase(await fx.arbitration.RESOLUTION_TIMEOUT());
    await fx.arbitration.resolveTimedOut(1);

    expect(await fx.registry.taskState(1)).to.equal(9); // RESOLVED
    const half = amount / 2n;
    expect(await fx.usdc.balanceOf(fx.worker.address)).to.equal(half);
    expect(await fx.usdc.balanceOf(fx.poster.address)).to.equal(half);
  });
});

describe("ReputationRegistry verifier bond", function () {
  it("stakes, unstakes, and slashes ETH to treasury", async function () {
    const fx = await deployAzzleStack();
    const stake = ethers.parseEther("1");
    const slash = ethers.parseEther("0.4");

    await fx.reputation.connect(fx.arbitrator).stakeVerifierBond({ value: stake });
    expect(await fx.reputation.verifierBond(fx.arbitrator.address)).to.equal(stake);

    await fx.reputation.connect(fx.arbitrator).unstakeVerifierBond(ethers.parseEther("0.3"));
    expect(await fx.reputation.verifierBond(fx.arbitrator.address)).to.equal(
      ethers.parseEther("0.7")
    );

    const reason = ethers.keccak256(ethers.toUtf8Bytes("false-attestation"));
    const registryAddr = await fx.registry.getAddress();
    await ethers.provider.send("hardhat_impersonateAccount", [registryAddr]);
    await ethers.provider.send("hardhat_setBalance", [
      registryAddr,
      "0x1000000000000000000",
    ]);
    const registrySigner = await ethers.getSigner(registryAddr);
    await fx.reputation
      .connect(registrySigner)
      .slashVerifierBond(fx.arbitrator.address, slash, reason);

    expect(await fx.reputation.verifierBond(fx.arbitrator.address)).to.equal(
      ethers.parseEther("0.3")
    );
    expect(await fx.treasury.accruedNative()).to.equal(slash);

    await fx.reputation.connect(fx.arbitrator).unstakeVerifierBond(ethers.parseEther("0.3"));
    expect(await fx.reputation.verifierBond(fx.arbitrator.address)).to.equal(0);
  });
});

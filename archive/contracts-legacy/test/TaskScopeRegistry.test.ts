import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployAzzleStack,
  topUpAgent,
  fundAzlForAgent,
  MIN_PLUS_FEE,
} from "./helpers/deploy";

describe("TaskScopeRegistry", function () {
  async function postTask(fx: Awaited<ReturnType<typeof deployAzzleStack>>) {
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
  }

  it("lets poster set and update scope; worker cannot", async function () {
    const fx = await deployAzzleStack();
    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await fundAzlForAgent(fx, fx.poster);
    await postTask(fx);

    const scopeRegistry = await (
      await ethers.getContractFactory("TaskScopeRegistry")
    ).deploy(await fx.registry.getAddress());

    const scopeV1 = "Build a subgraph indexer for open tasks on Base.";
    await scopeRegistry.connect(fx.poster).setScope(1, scopeV1);
    expect(await scopeRegistry.scopeOf(1)).to.equal(scopeV1);

    const scopeV2 = scopeV1 + " Include deadline filters.";
    await scopeRegistry.connect(fx.poster).setScope(1, scopeV2);
    expect(await scopeRegistry.scopeOf(1)).to.equal(scopeV2);

    await expect(
      scopeRegistry.connect(fx.worker).setScope(1, "malicious")
    ).to.be.revertedWith("TaskScope: not poster");
  });

  it("rejects unknown task id and empty scope", async function () {
    const fx = await deployAzzleStack();
    const scopeRegistry = await (
      await ethers.getContractFactory("TaskScopeRegistry")
    ).deploy(await fx.registry.getAddress());

    await expect(
      scopeRegistry.connect(fx.poster).setScope(1, "nope")
    ).to.be.revertedWith("TaskScope: unknown task");

    await topUpAgent(fx, fx.poster, MIN_PLUS_FEE);
    await fundAzlForAgent(fx, fx.poster);
    await postTask(fx);

    await expect(
      scopeRegistry.connect(fx.poster).setScope(1, "")
    ).to.be.revertedWith("TaskScope: empty scope");
  });
});

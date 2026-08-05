/**
 * List contract-creation txs from DEPLOYER (defaults to first signer).
 */
import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const deployer = process.env.DEPLOYER_ADDRESS?.trim() ?? signer.address;
  const provider = ethers.provider;
  const head = await provider.getBlockNumber();
  const window = Number(process.env.SCAN_BLOCKS ?? "5000");
  const creations: { nonce: number; address: string; hash: string; block: number }[] = [];

  for (let b = head; b > head - window; b--) {
    const block = await provider.getBlock(b, true);
    if (!block?.prefetchedTransactions) continue;
    for (const tx of block.prefetchedTransactions) {
      if (tx.from.toLowerCase() !== deployer.toLowerCase() || tx.to !== null) continue;
      const receipt = await provider.getTransactionReceipt(tx.hash);
      if (!receipt?.contractAddress) continue;
      creations.push({
        nonce: tx.nonce,
        address: receipt.contractAddress,
        hash: tx.hash,
        block: b,
      });
    }
  }

  creations.sort((a, b) => a.nonce - b.nonce);
  console.log("Deployer:", deployer);
  console.log("Contract creations (oldest first):");
  for (const c of creations) {
    console.log(`  nonce ${c.nonce}  ${c.address}  block ${c.block}  ${c.hash}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

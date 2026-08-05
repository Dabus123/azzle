import type { ContractTransactionResponse } from "ethers";

const STEP_DELAY_MS = 2_000;

/** Send tx and wait for 1 confirmation before the next nonce. */
export async function confirm(label: string, tx: Promise<ContractTransactionResponse>) {
  const sent = await tx;
  console.log(`${label} tx ${sent.hash}`);
  const receipt = await sent.wait(1);
  if (!receipt || receipt.status !== 1) {
    throw new Error(`${label} failed`);
  }
  await sleep(STEP_DELAY_MS);
  return receipt;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isZero(addr: string | null | undefined): boolean {
  return !addr || addr === "0x0000000000000000000000000000000000000000";
}

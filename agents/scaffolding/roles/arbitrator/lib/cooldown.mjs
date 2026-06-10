import { Contract } from "ethers";
import { loadManifest } from "./manifest.mjs";

const manifest = loadManifest(import.meta.url, "..", "base-8453.json");

/** 1 day — protocol/AGENT_LIFECYCLE.md */
export const REGISTER_COOLDOWN_SEC = 86_400;

const ARBITRATION_ABI = [
  "function lastRegistrationTime(address arbitrator) external view returns (uint256)",
];

export async function readLastRegistration(provider, arbitrator) {
  const mod = new Contract(manifest.ArbitrationModule, ARBITRATION_ABI, provider);
  return await mod.lastRegistrationTime(arbitrator);
}

export async function assertRegistrationCooldown(provider, arbitrator, nowSec = BigInt(Math.floor(Date.now() / 1000))) {
  const last = await readLastRegistration(provider, arbitrator);
  if (last === 0n) return { ok: true, waitSec: 0n };
  const elapsed = nowSec - last;
  if (elapsed >= BigInt(REGISTER_COOLDOWN_SEC)) return { ok: true, waitSec: 0n };
  const waitSec = BigInt(REGISTER_COOLDOWN_SEC) - elapsed;
  return {
    ok: false,
    waitSec,
    message: `REGISTER_COOLDOWN: wait ${waitSec}s before registerArbitrator again`,
  };
}

export async function guardRegistrationCooldown(provider, arbitrator) {
  const check = await assertRegistrationCooldown(provider, arbitrator);
  if (!check.ok) {
    throw new Error(check.message);
  }
  return check;
}

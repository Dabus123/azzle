import manifest from "../../deployments/base-8453.json" with { type: "json" };

export type BaseMainnetManifest = typeof manifest;

/** Canonical Base mainnet (8453) deployment manifest shipped with @azzle/agents. */
export const BASE_MAINNET_MANIFEST: BaseMainnetManifest = manifest;

export default BASE_MAINNET_MANIFEST;

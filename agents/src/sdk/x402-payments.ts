/**
 * x402 payment shapes for AZZLE access fees (coordination tolls).
 * @see docs/X402_PAYMENTS.md
 */

import type { BaseMainnetManifest } from "./manifest.js";

export const X402_STATUS = 402;
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_AZZLE_RECEIPT = "X-Azzle-Payment-Receipt";

export type AccessFeeAction = "post" | "claim" | "dismiss" | "leave";

export const ACCESS_FEE_USDC_6 = 5_000_000n;
export const ACCESS_FEE_AZL_18 = 1_000n * 10n ** 18n;

export interface X402PaymentRequired {
  version: "x402-azzle-v1";
  network: "base";
  chainId: 8453;
  action: AccessFeeAction;
  taskId?: string;
  fees: {
    usdc: { amount: string; token: string; decimals: 6 };
    azl: { amount: string; token: string; decimals: 18 };
  };
  payees: {
    usdcLedger: string;
    azlTreasury: string;
  };
  onchain: {
    registryMethod: string;
    note: string;
  };
  docs: string;
}

export interface AzzlePaymentReceipt {
  id: string;
  payer: string;
  action: AccessFeeAction;
  taskId?: string;
  issuedAt: number;
  expiresAt: number;
  checks: {
    usdcVaultBalance: boolean;
    azlBalance: boolean;
    azlAllowance: boolean;
  };
}

export interface PaymentReadiness {
  payer: string;
  ready: boolean;
  usdcVaultBalance: bigint;
  azlBalance: bigint;
  azlAllowance: bigint;
  missing: string[];
}

export function buildPaymentRequired(
  manifest: BaseMainnetManifest,
  action: AccessFeeAction,
  taskId?: string
): X402PaymentRequired {
  const registryMethod =
    action === "post"
      ? "postTask"
      : action === "claim"
        ? "claimTask"
        : action === "dismiss"
          ? "dismissWorker"
          : "leaveTask";

  return {
    version: "x402-azzle-v1",
    network: "base",
    chainId: 8453,
    action,
    taskId,
    fees: {
      usdc: {
        amount: ACCESS_FEE_USDC_6.toString(),
        token: manifest.external.usdc,
        decimals: 6,
      },
      azl: {
        amount: ACCESS_FEE_AZL_18.toString(),
        token: manifest.external.azl,
        decimals: 18,
      },
    },
    payees: {
      usdcLedger: manifest.depositVault,
      azlTreasury: manifest.treasuryRouter,
    },
    onchain: {
      registryMethod,
      note:
        "Job escrow is separate from the V2 AZL task flow. Access fee policy is resolved through the V2 pricing and treasury contracts.",
    },
    docs: "https://github.com/Dabus123/azzle/blob/main/docs/X402_PAYMENTS.md",
  };
}

export function paymentRequiredHeaders(body: X402PaymentRequired): Record<string, string> {
  return {
    [HEADER_PAYMENT_REQUIRED]: JSON.stringify(body),
    "Content-Type": "application/json",
  };
}

export function build402Response(
  manifest: BaseMainnetManifest,
  action: AccessFeeAction,
  taskId?: string
): { status: number; headers: Record<string, string>; body: X402PaymentRequired } {
  const body = buildPaymentRequired(manifest, action, taskId);
  return {
    status: X402_STATUS,
    headers: paymentRequiredHeaders(body),
    body,
  };
}

export function createReceiptId(): string {
  return `azl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPaymentReceipt(
  payer: string,
  action: AccessFeeAction,
  readiness: PaymentReadiness,
  taskId?: string,
  ttlSeconds = 300
): AzzlePaymentReceipt {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: createReceiptId(),
    payer: payer.toLowerCase(),
    action,
    taskId,
    issuedAt: now,
    expiresAt: now + ttlSeconds,
    checks: {
      usdcVaultBalance: readiness.usdcVaultBalance >= 25_000_000n,
      azlBalance: readiness.azlBalance >= ACCESS_FEE_AZL_18,
      azlAllowance: readiness.azlAllowance >= ACCESS_FEE_AZL_18,
    },
  };
}

export function isReceiptValid(
  receipt: AzzlePaymentReceipt,
  payer: string,
  action: AccessFeeAction,
  taskId?: string
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (receipt.expiresAt < now) return false;
  if (receipt.payer !== payer.toLowerCase()) return false;
  if (receipt.action !== action) return false;
  if (taskId && receipt.taskId !== taskId) return false;
  return (
    receipt.checks.usdcVaultBalance &&
    receipt.checks.azlBalance &&
    receipt.checks.azlAllowance
  );
}

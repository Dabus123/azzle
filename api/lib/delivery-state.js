const DELIVERY_GRACE_SECONDS = 86_400;

export function deliveryState(task, receipt = null, now = Math.floor(Date.now() / 1000)) {
  const deliveredAt = Number(task?.deliveredAt ?? 0);
  const deadline = Number(task?.deadline ?? 0);
  const state = task?.state;
  if (receipt && receipt.receiptHash) {
    return {
      status: "submitted",
      receiptHash: receipt.receiptHash,
      artifactCount: receipt.artifacts?.length ?? 0,
      available: Boolean(receipt.availability?.retrievalUri),
      releaseAction: state === "ACTIVE" ? "poster_release_or_complete" : "none",
    };
  }
  if (deliveredAt > 0) {
    const graceEndsAt = deliveredAt + DELIVERY_GRACE_SECONDS;
    return {
      status: now > graceEndsAt ? "delivery_grace_elapsed" : "delivered",
      deliveredAt,
      graceEndsAt,
      releaseAction: state === "ACTIVE" ? "poster_release_or_complete" : "none",
    };
  }
  if (deadline > 0 && now > deadline) {
    return { status: "deadline_elapsed", deadline, releaseAction: "expire_or_dispute" };
  }
  return { status: state === "ACTIVE" ? "in_progress" : "not_started", releaseAction: "none" };
}

export function validateDeliveryReceipt(receipt, taskId, worker) {
  const errors = [];
  if (!receipt || receipt.schemaVersion !== "azzle-receipt-v2") errors.push("schemaVersion must be azzle-receipt-v2");
  if (receipt?.taskId !== taskId) errors.push("receipt taskId does not match");
  if (worker && receipt?.worker?.toLowerCase() !== worker.toLowerCase()) errors.push("receipt worker does not match");
  if (!Array.isArray(receipt?.artifacts) || receipt.artifacts.length === 0) errors.push("at least one artifact is required");
  if (!/^0x[a-fA-F0-9]{64}$/.test(receipt?.receiptHash ?? "")) errors.push("receiptHash must be bytes32");
  return { valid: errors.length === 0, errors };
}

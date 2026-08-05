export function summarizeLedger(tasks = [], address) {
  const account = address?.toLowerCase();
  const summary = {
    protocolVersion: "v2",
    asset: "AZL",
    account: account ?? null,
    taskCount: 0,
    fundedAzlWei: "0",
    lockedAzlWei: "0",
    releasedAzlWei: "0",
    pendingAzlWei: "0",
    disputedAzlWei: "0",
    completed: 0,
    disputed: 0,
    cancelled: 0,
    deliveryAssertions: 0,
    entries: [],
  };
  let funded = 0n;
  let locked = 0n;
  let released = 0n;
  let pending = 0n;
  let disputed = 0n;
  for (const task of tasks) {
    const isPoster = !account || task.poster?.toLowerCase() === account;
    const isWorker = !account || task.worker?.toLowerCase() === account;
    if (!isPoster && !isWorker) continue;
    const total = BigInt(task.totalAmountAzlWei ?? task.escrowAmount ?? "0");
    const taskFunded = BigInt(task.fundedAzlWei ?? task.fundedAmount ?? "0");
    const taskReleased = BigInt(task.releasedAzlWei ?? task.releasedAmount ?? "0");
    const taskLocked = taskFunded > taskReleased ? taskFunded - taskReleased : 0n;
    const role = isWorker && !isPoster ? "worker" : "poster";
    taskFunded && (funded += taskFunded);
    locked += taskLocked;
    released += taskReleased;
    if (["CLAIMED", "ACTIVE", "DISPUTED"].includes(task.state)) pending += taskLocked;
    if (task.state === "DISPUTED") disputed += taskLocked;
    if (task.state === "COMPLETED") summary.completed += 1;
    if (task.state === "DISPUTED") summary.disputed += 1;
    if (task.state === "CANCELLED") summary.cancelled += 1;
    if (Number(task.deliveredAt ?? 0) > 0) summary.deliveryAssertions += 1;
    summary.entries.push({
      id: task.id?.startsWith("v2:") ? task.id : `v2:${task.id}`,
      role,
      state: task.state,
      totalAmountAzlWei: total.toString(),
      fundedAzlWei: taskFunded.toString(),
      lockedAzlWei: taskLocked.toString(),
      releasedAzlWei: taskReleased.toString(),
      deadline: task.deadline ?? null,
      deliveredAt: task.deliveredAt ?? null,
    });
  }
  summary.taskCount = summary.entries.length;
  summary.fundedAzlWei = funded.toString();
  summary.lockedAzlWei = locked.toString();
  summary.releasedAzlWei = released.toString();
  summary.pendingAzlWei = pending.toString();
  summary.disputedAzlWei = disputed.toString();
  return summary;
}

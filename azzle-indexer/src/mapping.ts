import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  TaskPosted as TaskPostedEvent,
  TaskCreated as TaskCreatedEvent,
  TaskClaimed as TaskClaimedEvent,
  TaskStateChanged as TaskStateChangedEvent,
  ProofSubmitted as ProofSubmittedEvent,
  WorkerReplaced as WorkerReplacedEvent,
} from "../generated/TaskRegistry/TaskRegistry";
import { MilestoneReleased as MilestoneReleasedEvent } from "../generated/EscrowVault/EscrowVault";
import {
  DisputeOpened as DisputeOpenedEvent,
  DisputeResolved as DisputeResolvedEvent,
} from "../generated/ArbitrationModule/ArbitrationModule";
import {
  ReputationSignalEmitted as ReputationSignalEmittedEvent,
  VerifierBondStaked as VerifierBondStakedEvent,
} from "../generated/ReputationRegistry/ReputationRegistry";
import { ArbitrationModule } from "../generated/ArbitrationModule/ArbitrationModule";
import { ReputationRegistry } from "../generated/ReputationRegistry/ReputationRegistry";
import { Dispute, ReputationSignal, Task } from "../generated/schema";
import {
  ARBITRATION_ADDRESS,
  REPUTATION_ADDRESS,
  agentId,
  defaultSignalWeight,
  loadOrCreateAgent,
  loadOrCreateTask,
  signalTypeName,
  syncTaskFromRegistry,
  taskStateName,
} from "./helpers";

export function handleTaskPosted(event: TaskPostedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.poster = agentId(event.params.poster);
  loadOrCreateAgent(event.params.poster);
  task.worker = null;
  task.state = "POSTED";
  task.settlementDigest = event.params.settlementDigest;
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleTaskCreated(event: TaskCreatedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.poster = agentId(event.params.poster);
  task.worker = agentId(event.params.worker);
  loadOrCreateAgent(event.params.poster);
  loadOrCreateAgent(event.params.worker);
  task.state = "ACTIVE";
  task.settlementDigest = event.params.settlementDigest;
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleTaskClaimed(event: TaskClaimedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.worker = agentId(event.params.worker);
  loadOrCreateAgent(event.params.worker);
  task.state = "CLAIMED";
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleTaskStateChanged(event: TaskStateChangedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.state = taskStateName(event.params.newState);
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleProofSubmitted(event: ProofSubmittedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.state = "IN_REVIEW";
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleMilestoneReleased(event: MilestoneReleasedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  syncTaskFromRegistry(task, event.params.taskId);
  task.updatedAt = event.block.timestamp;
  task.save();

  if (task.worker != null) {
    const worker = loadOrCreateAgent(Address.fromString(task.worker!));
    worker.tasksCompleted = worker.tasksCompleted + 1;
    worker.save();
  }
}

export function handleDisputeOpened(event: DisputeOpenedEvent): void {
  const disputeId = event.params.disputeId.toString();
  let dispute = Dispute.load(disputeId);
  if (dispute == null) {
    dispute = new Dispute(disputeId);
    dispute.task = event.params.taskId.toString();
    dispute.opener = event.params.initiator;
    dispute.save();
  }

  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  task.state = "DISPUTED";
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();
}

export function handleDisputeResolved(event: DisputeResolvedEvent): void {
  const disputeId = event.params.disputeId.toString();
  let dispute = Dispute.load(disputeId);
  if (dispute == null) {
    dispute = new Dispute(disputeId);
    dispute.task = "0";
    dispute.opener = Bytes.empty();
  }

  const arbitration = ArbitrationModule.bind(ARBITRATION_ADDRESS);
  const onchain = arbitration.try_disputes(event.params.disputeId);
  if (!onchain.reverted) {
    const d = onchain.value;
    dispute.task = d.value0.toString();
    dispute.opener = d.value1;
    if (d.value6.toHexString() != "0x0000000000000000000000000000000000000000") {
      dispute.arbitrator = d.value6;
    }
  }

  dispute.resolvedAt = event.block.timestamp;
  dispute.workerBps = event.params.workerBps.toI32();
  dispute.save();

  const task = Task.load(dispute.task);
  if (task != null && task.worker != null) {
    const workerWon = event.params.workerBps.ge(BigInt.fromI32(5000));
    const worker = loadOrCreateAgent(Address.fromString(task.worker!));
    const poster = loadOrCreateAgent(Address.fromString(task.poster));
    if (workerWon) {
      worker.disputesWon = worker.disputesWon + 1;
      poster.disputesLost = poster.disputesLost + 1;
    } else {
      worker.disputesLost = worker.disputesLost + 1;
      poster.disputesWon = poster.disputesWon + 1;
    }
    worker.save();
    poster.save();
    task.state = "RESOLVED";
    task.updatedAt = event.block.timestamp;
    task.save();
  }
}

export function handleReputationSignalEmitted(event: ReputationSignalEmittedEvent): void {
  const signalId = event.params.signalId.toString();
  if (ReputationSignal.load(signalId) != null) {
    return;
  }
  const signal = new ReputationSignal(signalId);
  const subject = loadOrCreateAgent(event.params.subject);
  const registry = ReputationRegistry.bind(REPUTATION_ADDRESS);
  const onchain = registry.try_signals(event.params.signalId);

  let weight = defaultSignalWeight(event.params.signalType);
  let emittedAt = event.block.timestamp;
  if (!onchain.reverted) {
    weight = onchain.value.value4;
    emittedAt = onchain.value.value5;
  }

  signal.subject = subject.id;
  signal.signalType = signalTypeName(event.params.signalType);
  signal.weight = weight;
  signal.emittedAt = emittedAt;
  signal.taskId = event.params.taskId;
  signal.save();

  subject.reputationScore = subject.reputationScore.plus(weight);
  subject.save();
}

export function handleVerifierBondStaked(event: VerifierBondStakedEvent): void {
  const agent = loadOrCreateAgent(event.params.verifier);
  agent.verifierBondEth = event.params.newBond;
  agent.save();
}

export function handleWorkerReplaced(event: WorkerReplacedEvent): void {
  const task = loadOrCreateTask(event.params.taskId, event.block.timestamp);
  const oldWorker = loadOrCreateAgent(event.params.oldWorker);
  const newWorker = loadOrCreateAgent(event.params.newWorker);

  task.worker = newWorker.id;
  task.updatedAt = event.block.timestamp;
  syncTaskFromRegistry(task, event.params.taskId);
  task.save();

  const penalty = BigInt.fromI32(200);
  oldWorker.reputationScore = oldWorker.reputationScore.minus(penalty);
  oldWorker.save();

  const signalId =
    event.transaction.hash.toHexString() +
    "-replace-" +
    event.params.taskId.toString();
  let signal = ReputationSignal.load(signalId);
  if (signal == null) {
    signal = new ReputationSignal(signalId);
    signal.subject = oldWorker.id;
    signal.signalType = "REPLACEMENT_PENALTY";
    signal.weight = penalty;
    signal.emittedAt = event.block.timestamp;
    signal.taskId = event.params.taskId;
    signal.save();
  }
}

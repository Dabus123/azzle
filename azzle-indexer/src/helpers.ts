import { BigInt, Address, Bytes } from "@graphprotocol/graph-ts";
import { Agent, Task } from "../generated/schema";
import { TaskRegistry } from "../generated/TaskRegistry/TaskRegistry";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
/** Must match contracts/deployments/base-8453.json TaskRegistry */
export const REGISTRY_ADDRESS = Address.fromString(
  "0x0a47c3a2d515ec3a23f225a7bac1b0a1654e4d48"
);
export const ARBITRATION_ADDRESS = Address.fromString(
  "0x1CFc919cA2C5eaD0A5b3365260c091AD7E1a31E0"
);
export const REPUTATION_ADDRESS = Address.fromString(
  "0x462dCB4903583D99889f4aD42C4c5008A519082a"
);

export function agentId(address: Address): string {
  return address.toHexString().toLowerCase();
}

export function loadOrCreateAgent(address: Address): Agent {
  const id = agentId(address);
  let agent = Agent.load(id);
  if (agent == null) {
    agent = new Agent(id);
    agent.reputationScore = BigInt.zero();
    agent.tasksCompleted = 0;
    agent.disputesWon = 0;
    agent.disputesLost = 0;
    agent.verifierBondEth = BigInt.zero();
    agent.save();
  }
  return agent;
}

export function taskStateName(state: i32): string {
  if (state == 0) return "DRAFT";
  if (state == 1) return "POSTED";
  if (state == 2) return "CLAIMED";
  if (state == 3) return "ACTIVE";
  if (state == 4) return "IN_REVIEW";
  if (state == 5) return "COMPLETED";
  if (state == 6) return "CANCELLED";
  if (state == 7) return "EXPIRED";
  if (state == 8) return "DISPUTED";
  if (state == 9) return "RESOLVED";
  if (state == 10) return "REPLACING";
  if (state == 11) return "PAUSED";
  if (state == 12) return "DELETED";
  return "UNKNOWN";
}

export function signalTypeName(signalType: i32): string {
  if (signalType == 0) return "TASK_COMPLETED";
  if (signalType == 1) return "TASK_FAILED";
  if (signalType == 2) return "DISPUTE_WON";
  if (signalType == 3) return "DISPUTE_LOST";
  if (signalType == 4) return "PROOF_REJECTED";
  if (signalType == 5) return "REPLACEMENT_PENALTY";
  if (signalType == 6) return "VERIFIER_ATTESTATION";
  if (signalType == 7) return "PEER_ENDORSEMENT";
  if (signalType == 8) return "ARBITRATOR_STANDBY";
  if (signalType == 9) return "ARBITRATOR_RESOLVED";
  return "UNKNOWN";
}

export function defaultSignalWeight(signalType: i32): BigInt {
  if (signalType == 5) return BigInt.fromI32(200);
  if (signalType == 8) return BigInt.fromI32(10);
  if (signalType == 9) return BigInt.fromI32(50);
  return BigInt.fromI32(100);
}

export function loadOrCreateTask(taskId: BigInt, timestamp: BigInt): Task {
  const id = taskId.toString();
  let task = Task.load(id);
  if (task == null) {
    task = new Task(id);
    task.state = "DRAFT";
    task.poster = agentId(Address.fromString(ZERO_ADDRESS));
    task.escrowAmount = BigInt.zero();
    task.createdAt = timestamp;
    task.updatedAt = timestamp;
    task.settlementDigest = Bytes.empty();
  }
  return task;
}

export function syncTaskFromRegistry(task: Task, taskId: BigInt): void {
  const registry = TaskRegistry.bind(REGISTRY_ADDRESS);
  const onchain = registry.try_tasks(taskId);
  if (onchain.reverted) return;

  const t = onchain.value;
  task.poster = agentId(t.value0);
  loadOrCreateAgent(t.value0);

  if (t.value1.toHexString() != ZERO_ADDRESS) {
    task.worker = agentId(t.value1);
    loadOrCreateAgent(t.value1);
  } else {
    task.worker = null;
  }

  task.escrowAmount = t.value3;
  task.state = taskStateName(t.value6);
  task.settlementDigest = t.value5;
  if (task.createdAt.equals(BigInt.zero())) {
    task.createdAt = t.value8;
  }
}

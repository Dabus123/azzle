import { Contract, ethers } from "ethers";
import type { OnChainCorrelationEvent, OnChainEventHandler } from "./types.js";
import type { XmtpNegotiationTransport } from "./transport.js";

const REGISTRY_EVENTS_ABI = [
  "event TaskCreated(uint256 indexed taskId, address indexed poster, address indexed worker, bytes32 settlementDigest)",
  "event ProofSubmitted(uint256 indexed taskId, uint256 milestoneIndex, bytes32 receiptHash)",
];

const ESCROW_EVENTS_ABI = [
  "event MilestoneReleased(uint256 indexed taskId, uint256 milestoneIndex, uint256 amount)",
];

const ARBITRATION_EVENTS_ABI = [
  "event DisputeOpened(uint256 indexed disputeId, uint256 indexed taskId, address initiator)",
  "event DisputeResolved(uint256 indexed disputeId, uint256 workerBps)",
];

type EventMeta = { blockNumber: number; transactionHash: string };

function eventMeta(args: unknown[]): EventMeta {
  const ev = args[args.length - 1] as { log?: EventMeta };
  return {
    blockNumber: ev.log?.blockNumber ?? 0,
    transactionHash: ev.log?.transactionHash ?? "",
  };
}

export interface ChainEventIndexerConfig {
  rpcUrl: string;
  registryAddress: string;
  escrowAddress: string;
  arbitrationAddress?: string;
  transport: XmtpNegotiationTransport;
}

/**
 * Subscribes to on-chain events and correlates them to open XMTP threads
 * via (taskId, negotiationId) — foundation for docs/indexer-schema.md.
 */
export class ChainEventIndexer {
  private handlers = new Set<OnChainEventHandler>();
  private contracts: Contract[] = [];

  constructor(private readonly config: ChainEventIndexerConfig) {}

  subscribe(handler: OnChainEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    const provider = new ethers.JsonRpcProvider(this.config.rpcUrl);
    const registry = new Contract(
      this.config.registryAddress,
      REGISTRY_EVENTS_ABI,
      provider
    );
    const escrow = new Contract(this.config.escrowAddress, ESCROW_EVENTS_ABI, provider);
    this.contracts.push(registry, escrow);

    registry.on("TaskCreated", (...args: unknown[]) => {
      const [taskId, poster, worker, settlementDigest] = args as [
        bigint,
        string,
        string,
        string,
        unknown,
      ];
      const meta = eventMeta(args);
      void this.emit({
        kind: "TaskCreated",
        taskId: taskId.toString(),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { poster, worker, settlementDigest },
      });
    });

    registry.on("ProofSubmitted", (...args: unknown[]) => {
      const [taskId, milestoneIndex, receiptHash] = args as [
        bigint,
        bigint,
        string,
        unknown,
      ];
      const meta = eventMeta(args);
      void this.emit({
        kind: "ProofSubmitted",
        taskId: taskId.toString(),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { milestoneIndex: Number(milestoneIndex), receiptHash },
      });
    });

    escrow.on("MilestoneReleased", (...args: unknown[]) => {
      const [taskId, milestoneIndex, amount] = args as [bigint, bigint, bigint, unknown];
      const meta = eventMeta(args);
      void this.emit({
        kind: "MilestoneReleased",
        taskId: taskId.toString(),
        blockNumber: meta.blockNumber,
        txHash: meta.transactionHash,
        data: { milestoneIndex: Number(milestoneIndex), amount: amount.toString() },
      });
    });

    if (this.config.arbitrationAddress) {
      const arbitration = new Contract(
        this.config.arbitrationAddress,
        ARBITRATION_EVENTS_ABI,
        provider
      );
      this.contracts.push(arbitration);

      arbitration.on("DisputeOpened", (...args: unknown[]) => {
        const [disputeId, taskId, initiator] = args as [bigint, bigint, string, unknown];
        const meta = eventMeta(args);
        void this.emit({
          kind: "DisputeOpened",
          taskId: taskId.toString(),
          blockNumber: meta.blockNumber,
          txHash: meta.transactionHash,
          data: { disputeId: disputeId.toString(), initiator },
        });
      });

      arbitration.on("DisputeResolved", (...args: unknown[]) => {
        const [disputeId, workerBps] = args as [bigint, bigint, unknown];
        const meta = eventMeta(args);
        void this.emit({
          kind: "DisputeResolved",
          taskId: "0",
          blockNumber: meta.blockNumber,
          txHash: meta.transactionHash,
          data: { disputeId: disputeId.toString(), workerBps: Number(workerBps) },
        });
      });
    }
  }

  private async emit(event: OnChainCorrelationEvent): Promise<void> {
    event.negotiationId =
      event.negotiationId ??
      (event.taskId !== "0"
        ? this.config.transport.resolveNegotiationId(event.taskId)
        : undefined);
    for (const handler of this.handlers) {
      await handler(event);
    }
  }

  stop(): void {
    for (const contract of this.contracts) {
      contract.removeAllListeners();
    }
    this.contracts = [];
  }
}

import { Connection, Client } from "@temporalio/client";
import type { EnvConfig } from "../config.js";

export class TemporalClient {
  private client: Client | null = null;
  private workflowIds: Map<string, string> = new Map();

  constructor(private config: EnvConfig) {}

  async connect(): Promise<void> {
    const connection = await Connection.connect({ address: this.config.temporalAddress });
    this.client = new Client({
      connection,
      namespace: this.config.temporalNamespace,
    });
  }

  private async getClient(): Promise<Client> {
    if (!this.client) await this.connect();
    return this.client!;
  }

  async startFollowUp(entityId: string): Promise<void> {
    const client = await this.getClient();
    const workflowId = `follow-up-${entityId}`;
    this.workflowIds.set(entityId, workflowId);
    await client.workflow.start("followUpWorkflow", {
      taskQueue: this.config.temporalTaskQueue,
      workflowId,
      args: [entityId, this.config.forceConfig.followUpDays],
    });
  }

  async signalReplyReceived(entityId: string): Promise<void> {
    const client = await this.getClient();
    const workflowId = this.workflowIds.get(entityId) ?? `follow-up-${entityId}`;
    const handle = client.workflow.getHandle(workflowId);
    await handle.signal("reply_received");
  }

  async startOnboardingDrip(entityId: string, steps: string[]): Promise<void> {
    const client = await this.getClient();
    await client.workflow.start("onboardingDripWorkflow", {
      taskQueue: this.config.temporalTaskQueue,
      workflowId: `onboarding-${entityId}`,
      args: [entityId, steps],
    });
  }

  async startSpawnApproval(niche: string, agents: string[]): Promise<void> {
    const client = await this.getClient();
    await client.workflow.start("spawnApprovalWorkflow", {
      taskQueue: this.config.temporalTaskQueue,
      workflowId: `spawn-${niche}-${Date.now()}`,
      args: [niche, agents],
    });
  }
}

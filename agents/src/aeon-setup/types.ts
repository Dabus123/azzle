export const AGENT_ROLES = ["worker", "poster", "verifier", "arbitrator"] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export interface RoleMeta {
  id: AgentRole;
  label: string;
  hint: string;
}

export const ROLE_CATALOG: RoleMeta[] = [
  {
    id: "worker",
    label: "Worker",
    hint: "Claim tasks, submit proofs, XMTP negotiation, solvency guard",
  },
  {
    id: "poster",
    label: "Poster",
    hint: "Post or direct-hire tasks, fund escrow, accept milestones",
  },
  {
    id: "verifier",
    label: "Verifier",
    hint: "Stake verifier bond, validate receipts, subgraph signals",
  },
  {
    id: "arbitrator",
    label: "Arbitrator",
    hint: "Standby registration, dispute resolution, tier gates",
  },
];

export interface AeonSetupOptions {
  role?: string;
  dir?: string;
  dryRun: boolean;
  aeonOverlay: boolean;
}

export function isAgentRole(value: string): value is AgentRole {
  return (AGENT_ROLES as readonly string[]).includes(value);
}

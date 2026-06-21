/** NATS subject registry — authoritative reference */

export const SUBJECTS = {
  DISCOVERY_REPO_FOUND: "discovery.repo.found",
  DISCOVERY_AGENT_FOUND: "discovery.agent.found",
  DISCOVERY_COMMUNITY_FOUND: "discovery.community.found",
  GRAPH_ENTITY_UPDATED: "graph.entity.updated",
  GRAPH_RELATIONSHIP_CREATED: "graph.relationship.created",
  OUTREACH_DRAFT_READY: "outreach.draft.ready",
  OUTREACH_SENT: "outreach.sent",
  OUTREACH_REPLIED: "outreach.replied",
  MISSION_ASSIGNED: "mission.assigned",
  SCORE_UPDATED: "score.updated",
  TREND_SIGNAL: "intelligence.trend.signal",
  SWARM_SPAWN_REQUEST: "expansion.swarm.spawn",
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

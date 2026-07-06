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
  OUTCOME_RECORDED: "brain.outcome.recorded",
  SIGNAL_DETECTED: "brain.signal.detected",
  PLAYBOOK_UPDATED: "brain.playbook.updated",
  MISSION_ASSIGNED: "mission.assigned",
  SCORE_UPDATED: "score.updated",
  AI_INCLUSION_ASSESSED: "intelligence.ai_inclusion.assessed",
  AAIES_CYCLE_COMPLETE: "intelligence.aaies.cycle_complete",
  TREND_SIGNAL: "intelligence.trend.signal",
  SWARM_SPAWN_REQUEST: "expansion.swarm.spawn",
  CONTENT_TRAILER_READY: "content.trailer.ready",
  REDDIT_THREAD_FOUND: "discovery.reddit.thread_found",
  FARCASTER_CAST_FOUND: "discovery.farcaster.cast_found",
} as const;

export type Subject = (typeof SUBJECTS)[keyof typeof SUBJECTS];

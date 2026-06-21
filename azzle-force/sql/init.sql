-- AZZLE FORCE canonical Postgres schema

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS entities_type_idx ON entities (type);
CREATE INDEX IF NOT EXISTS entities_name_idx ON entities (name);

CREATE TABLE IF NOT EXISTS missions (
  id UUID PRIMARY KEY,
  agent_type TEXT NOT NULL,
  target_entity_id UUID REFERENCES entities(id),
  status TEXT NOT NULL DEFAULT 'pending',
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS missions_agent_status_idx ON missions (agent_type, status);

CREATE TABLE IF NOT EXISTS outreach_events (
  id UUID PRIMARY KEY,
  entity_id UUID NOT NULL REFERENCES entities(id),
  channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  content_hash TEXT,
  subject TEXT,
  body TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS outreach_entity_idx ON outreach_events (entity_id);

CREATE TABLE IF NOT EXISTS scores (
  entity_id UUID NOT NULL REFERENCES entities(id),
  score_type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT,
  PRIMARY KEY (entity_id, score_type)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY,
  entity_id UUID,
  agent TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_agent_idx ON audit_events (agent, created_at);

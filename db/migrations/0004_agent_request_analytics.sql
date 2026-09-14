CREATE TABLE IF NOT EXISTS agent_requests (
  request_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  question_preview TEXT,
  evidence_status TEXT NOT NULL,
  confidence_score REAL,
  source_count INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_requests_created
  ON agent_requests(created_at);

CREATE INDEX IF NOT EXISTS idx_agent_requests_channel_created
  ON agent_requests(channel, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_requests_status_created
  ON agent_requests(evidence_status, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_requests_question_hash
  ON agent_requests(question_hash);

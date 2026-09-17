-- AI Engineering Knowledge Agent
-- D1 schema v3
-- MVP stores chunk text in D1 so R2 is optional, not a deployment blocker.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  source_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  author TEXT,
  publisher TEXT,
  publication_year INTEGER,
  edition TEXT,
  source_type TEXT NOT NULL DEFAULT 'book',
  grade TEXT NOT NULL,
  reference_score INTEGER,
  status TEXT NOT NULL,
  seed INTEGER NOT NULL DEFAULT 0,
  original_provider TEXT NOT NULL DEFAULT 'google-drive',
  original_file_id TEXT,
  original_folder TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS source_topics (
  source_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  PRIMARY KEY (source_id, topic),
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_versions (
  version_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  edition TEXT,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  r2_manifest_key TEXT,
  manifest_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT,
  archived_at TEXT,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  job_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  version_id TEXT,
  state TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  chapter TEXT,
  section TEXT,
  heading_path TEXT,
  chunk_index INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  token_count INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  content_text TEXT NOT NULL,
  r2_text_key TEXT,
  vector_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sources_status_grade
  ON sources(status, grade);

CREATE INDEX IF NOT EXISTS idx_chunks_source_status
  ON knowledge_chunks(source_id, status);

CREATE INDEX IF NOT EXISTS idx_chunks_version_status
  ON knowledge_chunks(version_id, status);

CREATE INDEX IF NOT EXISTS idx_jobs_source_state
  ON ingestion_jobs(source_id, state);

CREATE TABLE IF NOT EXISTS answer_feedback (
  feedback_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  helpful INTEGER NOT NULL CHECK (helpful IN (0, 1)),
  comment TEXT,
  channel TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_answer_feedback_request
  ON answer_feedback(request_id, created_at);

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

CREATE TABLE IF NOT EXISTS source_version_domains (
  version_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  domain_id TEXT NOT NULL,
  domain_label TEXT NOT NULL,
  evidence_chunk_count INTEGER NOT NULL DEFAULT 0,
  sample_chunk_ids_json TEXT NOT NULL DEFAULT '[]',
  sample_sections_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version_id, domain_id),
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_version_domains_source
  ON source_version_domains(source_id, version_id);

CREATE INDEX IF NOT EXISTS idx_source_version_domains_domain
  ON source_version_domains(domain_id, version_id);

CREATE TABLE IF NOT EXISTS knowledge_changes (
  change_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  previous_version_id TEXT,
  version_id TEXT NOT NULL,
  change_type TEXT NOT NULL,
  added_chunk_count INTEGER NOT NULL DEFAULT 0,
  removed_chunk_count INTEGER NOT NULL DEFAULT 0,
  unchanged_chunk_count INTEGER NOT NULL DEFAULT 0,
  added_domains_json TEXT NOT NULL DEFAULT '[]',
  removed_domains_json TEXT NOT NULL DEFAULT '[]',
  sample_added_json TEXT NOT NULL DEFAULT '[]',
  sample_removed_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, version_id),
  FOREIGN KEY (source_id) REFERENCES sources(source_id) ON DELETE CASCADE,
  FOREIGN KEY (version_id) REFERENCES source_versions(version_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_changes_created
  ON knowledge_changes(created_at);

CREATE INDEX IF NOT EXISTS idx_knowledge_changes_source
  ON knowledge_changes(source_id, created_at);

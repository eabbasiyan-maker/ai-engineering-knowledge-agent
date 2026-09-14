-- AI Engineering Knowledge Agent
-- D1 schema v1

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
  r2_text_key TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_jobs_source_state
  ON ingestion_jobs(source_id, state);
